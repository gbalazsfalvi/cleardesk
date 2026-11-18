"""A single bounded local embedding worker, separate from the DuckDB owner queue."""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODEL = "BAAI/bge-small-en-v1.5"
REVISION = "aa8f8b060edb00e03bfdd08813a2949946c8ba55"


def verify_snapshot(root: Path) -> tuple[Path, dict]:
    """Verify every recorded artifact before loading a local ONNX model."""
    record = json.loads((root / ".local/models/embedding-model.json").read_text("utf-8"))
    if record["model"] != MODEL or record["revision"] != REVISION or record["dimensions"] != 384:
        raise RuntimeError("EMBEDDING_PROVENANCE_INVALID")
    directory = (root / record["modelDirectory"]).resolve()
    if not directory.is_relative_to((root / ".local/models").resolve()):
        raise RuntimeError("EMBEDDING_PROVENANCE_INVALID")
    if not record["files"]:
        raise RuntimeError("EMBEDDING_PROVENANCE_INVALID")
    for item in record["files"]:
        path = (directory / item["path"]).resolve()
        if not path.is_relative_to(directory) or not path.is_file():
            raise RuntimeError("EMBEDDING_ARTIFACT_INVALID")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if path.stat().st_size != item["bytes"] or digest != item["sha256"]:
            raise RuntimeError("EMBEDDING_ARTIFACT_INVALID")
    return directory, record


class LocalEmbeddings:
    """No provider credential, network fallback or DuckDB handle enters this worker."""

    def __init__(self, root: Path):
        self.root = root
        self.ready = False
        self._model = None
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cleardesk-embed")
        self._slots = threading.BoundedSemaphore(4)

    def _embed(self, texts: list[str]) -> list[list[float]]:
        if self._model is None:
            from fastembed import TextEmbedding

            directory, _ = verify_snapshot(self.root)
            self._model = TextEmbedding(
                model_name=MODEL,
                specific_model_path=str(directory),
                cache_dir=str(self.root / ".local/models/cache"),
                threads=1,
                providers=["CPUExecutionProvider"],
                local_files_only=True,
            )
        result = [value.tolist() for value in self._model.embed(texts)]
        self.ready = True
        return result

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts or len(texts) > 128 or sum(len(t) for t in texts) > 140000:
            raise ValueError("INVALID_INPUT")
        if not self._slots.acquire(blocking=False):
            raise OverflowError("BUSY")
        try:
            pending = self._executor.submit(self._embed, texts)
        except BaseException:
            self._slots.release()
            raise
        pending.add_done_callback(lambda _: self._slots.release())
        wrapped = asyncio.wrap_future(pending)
        wrapped.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return await asyncio.shield(wrapped)

    def close(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=False)

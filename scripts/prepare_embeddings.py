"""Download a pinned ONNX snapshot and record actual bytes; never execute remote code."""

from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.request
from pathlib import Path

os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

ROOT = Path(__file__).resolve().parents[1]
os.environ["HF_HOME"] = str(ROOT / ".local/models/huggingface")
REPOSITORY = "Qdrant/bge-small-en-v1.5-onnx-Q"
MODEL = "BAAI/bge-small-en-v1.5"
REVISION = "aa8f8b060edb00e03bfdd08813a2949946c8ba55"


def main() -> None:
    import numpy as np
    from fastembed import TextEmbedding
    from huggingface_hub import snapshot_download

    manifest = ROOT / ".local/models/embedding-model.json"
    if manifest.exists():
        import sys

        sys.path.insert(0, str(ROOT / "services/knowledge"))
        from cleardesk.embeddings import verify_snapshot

        _, record = verify_snapshot(ROOT)
        print(
            json.dumps(
                {
                    "model": MODEL,
                    "revision": record["revision"],
                    "cacheVerification": "PASS",
                    "networkRequests": 0,
                }
            )
        )
        return

    request = urllib.request.Request(
        "https://huggingface.co/api/models/" + REPOSITORY + "/revision/" + REVISION,
        headers={"User-Agent": "ClearDesk-model-provenance/0.1.1"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        metadata = json.load(response)
    revision = metadata["sha"]
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or revision != REVISION:
        raise ValueError("The model repository did not provide an immutable revision")
    directory = ROOT / ".local/models/bge-small-en-v1.5" / revision
    snapshot_download(
        repo_id=REPOSITORY,
        revision=revision,
        token=False,
        local_dir=directory,
        allow_patterns=[
            "model_optimized.onnx",
            "*.json",
            "vocab.txt",
            "LICENSE*",
            "README.md",
        ],
        max_workers=2,
    )
    model = TextEmbedding(
        model_name=MODEL,
        specific_model_path=str(directory),
        cache_dir=str(ROOT / ".local/models/cache"),
        threads=1,
        providers=["CPUExecutionProvider"],
        local_files_only=True,
    )
    vectors = list(model.embed(["ClearDesk verifies local embeddings without provider traffic."]))
    if len(vectors) != 1 or vectors[0].shape != (384,) or not np.isfinite(vectors[0]).all():
        raise ValueError("The actual embedding model failed its dimensional/finite check")
    files = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or ".cache" in path.relative_to(directory).parts:
            continue
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        files.append(
            {
                "path": path.relative_to(directory).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": digest,
            }
        )
    record = {
        "model": MODEL,
        "repository": REPOSITORY,
        "revision": revision,
        "dimensions": 384,
        "provider": "CPUExecutionProvider",
        "threads": 1,
        "modelDirectory": directory.relative_to(ROOT).as_posix(),
        "licenseMetadata": metadata.get("cardData", {}).get("license"),
        "files": files,
        "actualFiniteVectorCheck": "PASS",
    }
    target = ROOT / ".local/models/embedding-model.json"
    target.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "model": MODEL,
                "revision": revision,
                "dimensions": 384,
                "filesHashed": len(files),
                "actualFiniteVectorCheck": "PASS",
            }
        )
    )


if __name__ == "__main__":
    main()

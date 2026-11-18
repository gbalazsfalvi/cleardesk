"""Bootstrap must recover its own interrupted initialization without resetting credentials."""

import asyncio
import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def seed(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[3]
    spec = importlib.util.spec_from_file_location(
        "cleardesk_seed_test", root / "scripts/seed_demo.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    (tmp_path / "verification").mkdir()
    (tmp_path / "verification/corpus.json").write_bytes(
        (root / "verification/corpus.json").read_bytes()
    )
    monkeypatch.setattr(module, "ROOT", tmp_path)

    class Embeddings:
        fail = False

        def __init__(self, _root):
            pass

        async def embed(self, texts):
            if self.fail:
                raise RuntimeError("SIMULATED_EMBEDDING_FAILURE")
            return [[1.0] + [0.0] * 383 for _ in texts]

        def close(self):
            pass

    monkeypatch.setattr(module, "LocalEmbeddings", Embeddings)
    return module, tmp_path, Embeddings


def test_repeated_bootstrap_preserves_the_generated_passwords(seed):
    module, root, _ = seed
    asyncio.run(module.main())
    original = (root / ".local/private/demo-accounts.json").read_bytes()
    asyncio.run(module.main())
    assert (root / ".local/private/demo-accounts.json").read_bytes() == original


def test_manifest_without_its_database_fails_closed(seed):
    module, root, _ = seed
    asyncio.run(module.main())
    (root / ".local/data/cleardesk.duckdb").unlink()
    with pytest.raises(RuntimeError, match="DEMO_MANIFEST_DATABASE_MISMATCH"):
        asyncio.run(module.main())


def test_interrupted_initialization_can_resume_without_credential_reset(seed):
    module, root, embeddings = seed
    embeddings.fail = True
    with pytest.raises(RuntimeError, match="SIMULATED_EMBEDDING_FAILURE"):
        asyncio.run(module.main())
    manifest = root / ".local/private/demo-accounts.json"
    assert manifest.exists()
    passwords = [item["password"] for item in json.loads(manifest.read_text())["accounts"]]
    embeddings.fail = False
    asyncio.run(module.main())
    resumed = json.loads(manifest.read_text())
    assert resumed["phase"] == "COMPLETE"
    assert [item["password"] for item in resumed["accounts"]] == passwords
    assert len(resumed["documents"]) == 7

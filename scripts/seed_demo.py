"""Initialize fictional local data once; generated credentials stay in ignored private state."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
from pathlib import Path

from cleardesk.db import Database
from cleardesk.documents import DocumentStore, split_text
from cleardesk.embeddings import LocalEmbeddings
from cleardesk.identity import IdentityStore
from cleardesk.policy import Role

ROOT = Path(__file__).resolve().parents[1]
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def checkpoint(target: Path, record: dict) -> None:
    """Durably record generated passwords before creating any matching database account."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".pending")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(record, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(0o600)
    os.replace(temporary, target)


async def main() -> None:
    root = ROOT
    db = Database(root / ".local/data/cleardesk.duckdb")
    embeddings = LocalEmbeddings(root)
    try:
        identity = IdentityStore(db)
        documents = DocumentStore(db, identity)
        corpus_bytes = (root / "verification/corpus.json").read_bytes()
        corpus = json.loads(corpus_bytes)
        corpus_sha = hashlib.sha256(corpus_bytes).hexdigest()
        target = root / ".local/private/demo-accounts.json"
        if target.exists():
            record = json.loads(target.read_text("utf-8"))
            if record.get("phase", "COMPLETE") == "COMPLETE":
                for account in record["accounts"]:
                    if not db.connection.execute(
                        "SELECT 1 FROM users WHERE id=? AND username=?",
                        [account["id"], account["username"]],
                    ).fetchone():
                        raise RuntimeError("DEMO_MANIFEST_DATABASE_MISMATCH")
                for workspace in record["workspaces"].values():
                    if not db.connection.execute(
                        "SELECT 1 FROM workspaces WHERE id=?", [workspace]
                    ).fetchone():
                        raise RuntimeError("DEMO_MANIFEST_DATABASE_MISMATCH")
                print(
                    json.dumps(
                        {
                            "demo": "already-initialized",
                            "credentials": ".local/private/demo-accounts.json",
                        }
                    )
                )
                return
            if record.get("phase") != "INITIALIZING" or record.get("corpusSha256") != corpus_sha:
                raise RuntimeError("DEMO_INITIALIZATION_STATE_INVALID")
        else:
            if db.connection.execute("SELECT count(*) FROM users").fetchone()[0]:
                raise RuntimeError("EXISTING_DATABASE_WITHOUT_DEMO_MANIFEST")
            record = {
                "phase": "INITIALIZING",
                "corpusSha256": corpus_sha,
                "workspaces": {},
                "documents": {},
                "accounts": [
                    {**account, "password": secrets.token_urlsafe(18)}
                    for account in corpus["accounts"]
                ],
            }
            checkpoint(target, record)
        workspaces, accounts = record["workspaces"], record["accounts"]
        for workspace in corpus["workspaces"]:
            if workspace["key"] not in workspaces:
                existing = db.connection.execute(
                    "SELECT id FROM workspaces WHERE name=?", [workspace["name"]]
                ).fetchall()
                if len(existing) > 1:
                    raise RuntimeError("DEMO_INITIALIZATION_STATE_INVALID")
                workspaces[workspace["key"]] = (
                    existing[0][0] if existing else identity.create_workspace(workspace["name"])
                )
                checkpoint(target, record)
        for account in accounts:
            account["id"] = identity.create_user(
                account["username"], account["displayName"], account["password"]
            )
            for key, role in account["memberships"].items():
                current = db.connection.execute(
                    "SELECT role FROM memberships WHERE user_id=? AND workspace_id=?",
                    [account["id"], workspaces[key]],
                ).fetchone()
                if not current or current[0] != role:
                    identity.set_membership(account["id"], workspaces[key], Role(role))
            checkpoint(target, record)
        admin = next(account for account in accounts if account["username"] == "jordan")
        anonymous = identity.create_anonymous_session()
        signed = identity.login(
            anonymous["token"],
            anonymous["csrfToken"],
            admin["username"],
            admin["password"],
        )
        document_ids = record["documents"]
        for workspace in corpus["workspaces"]:
            for item in workspace["documents"]:
                data = {key: value for key, value in item.items() if key != "key"}
                digest = hashlib.sha256(data["text"].encode("utf-8")).hexdigest()
                existing = db.connection.execute(
                    "SELECT id FROM documents WHERE workspace_id=? AND filename=? "
                    "AND content_sha256=? AND NOT deleted",
                    [workspaces[workspace["key"]], data["filename"], digest],
                ).fetchone()
                if existing:
                    document_ids[item["key"]] = existing[0]
                    checkpoint(target, record)
                    continue
                vectors = await embeddings.embed(split_text(data["text"]))
                document = documents.ingest(
                    signed["token"], workspaces[workspace["key"]], data, vectors
                )
                document_ids[item["key"]] = document["id"]
                checkpoint(target, record)
        identity.logout(signed["token"], signed["csrfToken"])
        record["phase"] = "COMPLETE"
        checkpoint(target, record)
        print(
            json.dumps(
                {
                    "demo": "initialized",
                    "accounts": len(accounts),
                    "documents": len(document_ids),
                    "credentials": ".local/private/demo-accounts.json",
                }
            )
        )
    finally:
        embeddings.close()
        db.close()


if __name__ == "__main__":
    asyncio.run(main())

"""Initialize fictional local data once; generated credentials stay in ignored private state."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/knowledge"))
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from cleardesk.db import Database
from cleardesk.documents import DocumentStore, split_text
from cleardesk.embeddings import LocalEmbeddings
from cleardesk.identity import IdentityStore
from cleardesk.policy import Role


async def main() -> None:
    root = ROOT
    db = Database(root / ".local/data/cleardesk.duckdb")
    embeddings = LocalEmbeddings(root)
    try:
        identity = IdentityStore(db)
        documents = DocumentStore(db, identity)
        corpus = json.loads((root / "verification/corpus.json").read_text("utf-8"))
        target = root / ".local/private/demo-accounts.json"
        if target.exists():
            print(
                json.dumps(
                    {
                        "demo": "already-initialized",
                        "credentials": ".local/private/demo-accounts.json",
                    }
                )
            )
            return
        if db.connection.execute("SELECT count(*) FROM users").fetchone()[0]:
            raise RuntimeError("EXISTING_DATABASE_WITHOUT_DEMO_MANIFEST")
        workspaces = {
            item["key"]: identity.create_workspace(item["name"])
            for item in corpus["workspaces"]
        }
        accounts = []
        for account in corpus["accounts"]:
            password = secrets.token_urlsafe(18)
            user = identity.create_user(
                account["username"], account["displayName"], password
            )
            for key, role in account["memberships"].items():
                identity.set_membership(user, workspaces[key], Role(role))
            accounts.append({**account, "id": user, "password": password})
        admin = next(account for account in accounts if account["username"] == "jordan")
        anonymous = identity.create_anonymous_session()
        signed = identity.login(
            anonymous["token"],
            anonymous["csrfToken"],
            admin["username"],
            admin["password"],
        )
        document_ids = {}
        for workspace in corpus["workspaces"]:
            for item in workspace["documents"]:
                data = {key: value for key, value in item.items() if key != "key"}
                vectors = await embeddings.embed(split_text(data["text"]))
                document = documents.ingest(
                    signed["token"], workspaces[workspace["key"]], data, vectors
                )
                document_ids[item["key"]] = document["id"]
        identity.logout(signed["token"], signed["csrfToken"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(
                {
                    "accounts": accounts,
                    "workspaces": workspaces,
                    "documents": document_ids,
                },
                indent=2,
            )
            + "\n",
            "utf-8",
        )
        target.chmod(0o600)
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

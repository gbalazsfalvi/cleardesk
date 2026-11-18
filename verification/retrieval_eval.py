"""Measure a small frozen English retrieval set with actual pinned local ONNX embeddings."""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import os
import secrets
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from cleardesk.db import Database
from cleardesk.documents import DocumentStore, split_text
from cleardesk.embeddings import LocalEmbeddings, verify_snapshot
from cleardesk.identity import IdentityStore
from cleardesk.policy import Role

ROOT = Path(__file__).resolve().parents[1]
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

CASES = [
    (
        "R01",
        "member",
        "northstar",
        "How many remote working days are permitted each week?",
        "handbook",
    ),
    (
        "R02",
        "member",
        "northstar",
        "What is the daily meal allowance and expense claim deadline?",
        "expenses",
    ),
    (
        "R03",
        "member",
        "northstar",
        "I lost my work device. How should I report it?",
        "security",
    ),
    ("R04", "hr", "northstar", "When does the People team review compensation?", "hr"),
    (
        "R05",
        "member",
        "northstar",
        "Harbor Glass Finch acquisition project details",
        None,
    ),
    (
        "R06",
        "member",
        "harbor",
        "How do I request project repository access at Harbor?",
        "harbor-guide",
    ),
]


async def main() -> None:
    corpus_bytes = (ROOT / "verification/corpus.json").read_bytes()
    corpus = json.loads(corpus_bytes)
    _, manifest = verify_snapshot(ROOT)
    embeddings = LocalEmbeddings(ROOT)
    local = (ROOT / ".local").resolve()
    local.mkdir(exist_ok=True)
    records = []
    try:
        with TemporaryDirectory(prefix="retrieval-eval-", dir=local) as temporary:
            if not Path(temporary).resolve().is_relative_to(local):
                raise RuntimeError("OWNED_TEMPORARY_PATH_REQUIRED")
            database = Database(Path(temporary) / "evaluation.duckdb")
            try:
                identity = IdentityStore(database)
                documents = DocumentStore(database, identity)
                workspaces = {
                    item["key"]: identity.create_workspace(item["name"])
                    for item in corpus["workspaces"]
                }
                tokens = {}
                for name, role in [
                    ("admin", Role.ADMIN),
                    ("member", Role.MEMBER),
                    ("hr", Role.HR),
                ]:
                    password = secrets.token_urlsafe(18)
                    user = identity.create_user(name, name.title(), password)
                    for workspace in workspaces.values():
                        identity.set_membership(user, workspace, role)
                    anonymous = identity.create_anonymous_session()
                    tokens[name] = identity.login(
                        anonymous["token"], anonymous["csrfToken"], name, password
                    )["token"]
                keys, public_north = {}, set()
                for workspace in corpus["workspaces"]:
                    for source in workspace["documents"]:
                        value = {key: item for key, item in source.items() if key != "key"}
                        vectors = await embeddings.embed(split_text(value["text"]))
                        result = documents.ingest(
                            tokens["admin"],
                            workspaces[workspace["key"]],
                            value,
                            vectors,
                        )
                        keys[result["id"]] = source["key"]
                        if workspace["key"] == "northstar" and source["visibility"] == "WORKSPACE":
                            public_north.add(result["id"])
                for identifier, actor, workspace, question, expected in CASES:
                    try:
                        vector = (await embeddings.embed([question]))[0]
                        hits = documents.search(tokens[actor], workspaces[workspace], vector, 3)
                        top = [
                            {
                                "sourceKey": keys[hit["documentId"]],
                                "similarity": round(hit["similarity"], 6),
                            }
                            for hit in hits
                        ]
                        passed = (
                            (bool(top) and top[0]["sourceKey"] == expected)
                            if expected
                            else (
                                bool(hits)
                                and all(hit["documentId"] in public_north for hit in hits)
                            )
                        )
                        records.append(
                            {
                                "id": identifier,
                                "role": actor.upper(),
                                "workspace": workspace,
                                "question": question,
                                "expectedSource": expected,
                                "kind": "known-answer" if expected else "scope-control",
                                "status": "PASS" if passed else "FAIL",
                                "top3": top,
                            }
                        )
                    except (ValueError, LookupError, RuntimeError, OverflowError):
                        records.append(
                            {
                                "id": identifier,
                                "status": "ERROR",
                                "errorCode": "RETRIEVAL_CASE_ERROR",
                            }
                        )
            finally:
                database.close()
    finally:
        embeddings.close()
    generated = datetime.now(UTC).isoformat()
    status = (
        "ERROR"
        if any(item["status"] == "ERROR" for item in records)
        else (
            "FAIL"
            if any(item["status"] == "FAIL" for item in records)
            else ("PASS" if len(records) == len(CASES) else "INCOMPLETE")
        )
    )

    def digest(relative):
        return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()

    async def git(*arguments):
        return (
            await asyncio.to_thread(
                subprocess.check_output, ["git", *arguments], cwd=ROOT, text=True
            )
        ).strip()

    revision = await git("rev-parse", "HEAD")
    dirty = bool(await git("status", "--porcelain"))
    known = [item for item in records if item.get("kind") == "known-answer"]
    report = {
        "kind": "actual-local-embedding-retrieval",
        "status": status,
        "generatedAt": generated,
        "providerGenerationRequests": 0,
        "sourceRevision": revision,
        "workingTreeDirty": dirty,
        "corpusSha256": hashlib.sha256(corpus_bytes).hexdigest(),
        "evaluationScriptSha256": digest("verification/retrieval_eval.py"),
        "retrievalCodeSha256": digest("services/knowledge/cleardesk/documents.py"),
        "pythonLockSha256": digest("services/knowledge/requirements.lock"),
        "model": {
            key: manifest[key]
            for key in [
                "model",
                "repository",
                "revision",
                "dimensions",
                "provider",
                "files",
            ]
        },
        "knownAnswerTop1": {
            "correct": sum(item["status"] == "PASS" for item in known),
            "total": 5,
        },
        "cases": records,
        "limitations": [
            "Five fixed English known-answer questions and one scope control, "
            "not a statistical retrieval benchmark.",
            "Uses actual local ONNX vectors and production DuckDB retrieval code "
            "in a separate owned temporary database.",
            "No Gemini result, model answer or semantic-accuracy claim is implied.",
        ],
    }
    directory = (
        ROOT / "artifacts/runs/retrieval" / (generated.replace(":", "-") + "-" + str(uuid4())[:8])
    )
    directory.mkdir(parents=True)
    markdown = "# ClearDesk local retrieval evaluation\n\n" + status + " · " + generated + "\n\n"
    markdown += "| Case | Kind | Result | Top source |\n|---|---|---|---|\n"
    for item in records:
        top = item.get("top3", [{}])[0].get("sourceKey", "unavailable")
        markdown += (
            f"| {item['id']} | {item.get('kind', 'unavailable')} | {item['status']} | {top} |\n"
        )
    markdown += "\n" + "\n".join("- " + text for text in report["limitations"]) + "\n"
    serialized = json.dumps(report, indent=2) + "\n"
    page = (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" '
        "content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        "<title>ClearDesk · Local retrieval evidence</title><style>"
        "body{font:15px/1.7 system-ui;max-width:1000px;margin:50px auto;padding:24px;"
        "color:#294631;background:#f5f8ee}pre{white-space:pre-wrap;"
        "word-break:break-word;font-size:12px}</style>"
        "<h1>Local vectors. Explicit sources.</h1>"
        "<p>Actual pinned ONNX retrieval; no provider generation.</p><pre>"
        + html.escape(serialized)
        + "</pre></html>"
    )
    outputs = {"report.json": serialized, "report.md": markdown, "report.html": page}
    for name, content in outputs.items():
        (directory / name).write_bytes(content.encode("utf-8"))
    (directory / "SHA256SUMS").write_bytes(
        (
            "".join(
                hashlib.sha256(content.encode()).hexdigest() + "  " + name + "\n"
                for name, content in outputs.items()
            )
        ).encode("utf-8")
    )
    print(
        json.dumps(
            {
                "kind": report["kind"],
                "status": status,
                "knownAnswerTop1": report["knownAnswerTop1"],
                "cases": len(records),
                "providerGenerationRequests": 0,
            }
        )
    )
    if status != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())

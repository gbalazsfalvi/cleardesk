"""Owned threads and complete model-context provenance with current-access replay checks."""

from __future__ import annotations

import json
from uuid import UUID, uuid4

from .db import Database
from .documents import DocumentStore
from .identity import IdentityStore
from .policy import ActorContext

SAFE_TEXT = {
    "ACCESS_REVOKED": "This answer is hidden because access to its source context has changed.",
    "ACCESS_CHANGED": "Knowledge permissions changed during this request. Please ask again.",
    "CANCELLED": "This request was cancelled.",
    "PROVIDER_ERROR": "The model could not complete this request. Please try again later.",
    "UNVERIFIED_RESPONSE": "The model response could not be verified against its sources.",
    "PENDING": "This request is still in progress.",
}


class ConversationStore:
    """The model never chooses an owner, workspace or revision for these operations."""

    def __init__(self, database: Database, identity: IdentityStore, documents: DocumentStore):
        self.db, self.identity, self.documents = database, identity, documents

    def _thread(self, token: str, workspace: str, conversation: str) -> ActorContext:
        actor = self.identity.actor_context(token, workspace)
        if not self.db.connection.execute(
            "SELECT 1 FROM conversations WHERE id=? AND user_id=? AND workspace_id=?",
            [conversation, actor.user_id, workspace],
        ).fetchone():
            raise LookupError("NOT_FOUND")
        return actor

    def list(self, token: str, workspace: str) -> list[dict]:
        actor = self.identity.actor_context(token, workspace)
        return [
            {"id": row[0], "title": row[1], "updatedAt": row[2].isoformat()}
            for row in self.db.connection.execute(
                "SELECT id,title,updated_at FROM conversations WHERE user_id=? AND workspace_id=? "
                "ORDER BY updated_at DESC LIMIT 100",
                [actor.user_id, workspace],
            ).fetchall()
        ]

    def create(self, token: str, workspace: str, data: dict) -> dict:
        actor = self.identity.actor_context(token, workspace)
        if set(data) - {"title"}:
            raise ValueError("INVALID_INPUT")
        title = data.get("title", "New conversation")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
            raise ValueError("INVALID_INPUT")
        if (
            self.db.connection.execute(
                "SELECT count(*) FROM conversations WHERE user_id=? AND workspace_id=?",
                [actor.user_id, workspace],
            ).fetchone()[0]
            >= 100
        ):
            raise ValueError("CORPUS_LIMIT")
        identifier, now = str(uuid4()), self.db.now()
        self.db.connection.execute(
            "INSERT INTO conversations VALUES (?,?,?,?,?)",
            [identifier, actor.user_id, workspace, title.strip(), now],
        )
        return {"id": identifier, "title": title.strip(), "updatedAt": now.isoformat()}

    def _turn(self, conversation: str, turn: str) -> tuple:
        row = self.db.connection.execute(
            "SELECT id,question,revision,status,answer,citations_json,model_json,created_at "
            "FROM turns WHERE id=? AND conversation_id=?",
            [turn, conversation],
        ).fetchone()
        if not row:
            raise LookupError("NOT_FOUND")
        return row

    def _contexts(self, actor: ActorContext, turn: str) -> list[dict]:
        chunks = self.db.connection.execute(
            "SELECT d.id,c.id,d.title,c.content,d.content_sha256,d.version,1.0 "
            "FROM turn_context tc JOIN chunks c ON c.id=tc.chunk_id "
            "JOIN documents d ON d.id=c.document_id WHERE tc.turn_id=? ORDER BY c.id",
            [turn],
        ).fetchall()
        for row in chunks:
            self.documents._document(actor, row[0])
        return [self.documents._chunk(row) for row in chunks]

    def _accessible(self, actor: ActorContext, turn: str) -> bool:
        try:
            self._contexts(actor, turn)
        except LookupError:
            return False
        return True

    def _citations(self, actor: ActorContext, turn: str, citations: list[dict]) -> list[dict]:
        registry = {(c["documentId"], c["chunkId"]): c for c in self._contexts(actor, turn)}
        result = []
        for item in citations:
            key = (item["documentId"], item["chunkId"])
            if key not in registry:
                raise ValueError("UNVERIFIED_RESPONSE")
            chunk = registry[key]
            result.append(
                {
                    "documentId": key[0],
                    "chunkId": key[1],
                    "title": chunk["title"],
                    "excerpt": chunk["text"][:350],
                    "contentSha256": chunk["contentSha256"],
                    "href": (
                        f"/api/workspaces/{actor.workspace_id}/sources/{key[0]}?chunkId={key[1]}"
                    ),
                }
            )
        return result

    def _reply(self, actor: ActorContext, row: tuple) -> dict:
        status, answer, sources = row[3], row[4], []
        if not self._accessible(actor, row[0]):
            status, answer = "ACCESS_REVOKED", None
        elif status == "ANSWERED":
            sources = self._citations(actor, row[0], json.loads(row[5]))
        return {
            "turnId": row[0],
            "status": status,
            "answer": answer,
            "sources": sources,
            "model": json.loads(row[6]),
        }

    def messages(self, token: str, workspace: str, conversation: str) -> list[dict]:
        actor = self._thread(token, workspace, conversation)
        rows = self.db.connection.execute(
            "SELECT id FROM turns WHERE conversation_id=? ORDER BY created_at,id LIMIT 100",
            [conversation],
        ).fetchall()
        result = []
        for (identifier,) in rows:
            row = self._turn(conversation, identifier)
            reply = self._reply(actor, row)
            result.append(
                {
                    "id": identifier + ":user",
                    "role": "user",
                    "text": row[1],
                    "status": row[3],
                    "createdAt": row[7].isoformat(),
                    "sources": [],
                }
            )
            result.append(
                {
                    "id": identifier,
                    "role": "assistant",
                    "text": reply["answer"]
                    or SAFE_TEXT.get(reply["status"], "No answer available."),
                    "status": reply["status"],
                    "createdAt": row[7].isoformat(),
                    "sources": reply["sources"],
                }
            )
        return result

    def prepare(
        self, token: str, workspace: str, conversation: str, question: str, request_key: str
    ) -> dict:
        actor = self._thread(token, workspace, conversation)
        UUID(request_key)
        if not isinstance(question, str) or not 1 <= len(question) <= 2000 or not question.strip():
            raise ValueError("INVALID_INPUT")
        question.encode("utf-8")
        existing = self.db.connection.execute(
            "SELECT id,question FROM turns WHERE conversation_id=? AND request_key=?",
            [conversation, request_key],
        ).fetchone()
        if existing:
            if existing[1] != question:
                raise ValueError("REQUEST_CONFLICT")
            return {"isNew": False, **self._reply(actor, self._turn(conversation, existing[0]))}
        if (
            self.db.connection.execute(
                "SELECT count(*) FROM turns WHERE conversation_id=?", [conversation]
            ).fetchone()[0]
            >= 50
        ):
            raise ValueError("CORPUS_LIMIT")
        previous = self.db.connection.execute(
            "SELECT id FROM turns WHERE conversation_id=? "
            "AND status IN ('ANSWERED','INSUFFICIENT_KNOWLEDGE') "
            "ORDER BY created_at DESC,id LIMIT 3",
            [conversation],
        ).fetchall()
        history, dependencies = [], set()
        for (identifier,) in reversed(previous):
            if not self._accessible(actor, identifier):
                continue
            row = self._turn(conversation, identifier)
            history.extend(
                [{"role": "user", "content": row[1]}, {"role": "assistant", "content": row[4]}]
            )
            dependencies.update(chunk["chunkId"] for chunk in self._contexts(actor, identifier))
        identifier = str(uuid4())
        with self.db.transaction() as connection:
            connection.execute(
                "INSERT INTO turns VALUES (?,?,?,?,?,'PENDING',NULL,'[]',?,?)",
                [
                    identifier,
                    conversation,
                    request_key,
                    question,
                    actor.revision,
                    json.dumps({"mode": "fixture", "id": None, "version": None}),
                    self.db.now(),
                ],
            )
            for chunk_id in dependencies:
                connection.execute("INSERT INTO turn_context VALUES (?,?)", [identifier, chunk_id])
            connection.execute(
                "UPDATE conversations SET updated_at=? WHERE id=?", [self.db.now(), conversation]
            )
            # A user-authored title cannot expose a restricted model-generated summary.
            connection.execute(
                "UPDATE conversations SET title=? WHERE id=? AND title='New conversation'",
                [question[:80], conversation],
            )
        return {
            "isNew": True,
            "turnId": identifier,
            "revision": actor.revision,
            "history": history,
            "status": "PENDING",
        }

    def check_revision(
        self, token: str, workspace: str, conversation: str, turn: str
    ) -> ActorContext:
        actor = self._thread(token, workspace, conversation)
        row = self._turn(conversation, turn)
        if row[3] != "PENDING":
            raise ValueError("TURN_NOT_PENDING")
        if actor.revision != row[2]:
            raise ValueError("ACCESS_CHANGED")
        return actor

    def register_context(
        self, token: str, workspace: str, conversation: str, turn: str, chunks: list[dict]
    ) -> None:
        actor = self.check_revision(token, workspace, conversation, turn)
        if len(chunks) > 6:
            raise ValueError("INVALID_INPUT")
        identifiers = []
        for chunk in chunks:
            self.documents._document(actor, chunk["documentId"])
            if not self.db.connection.execute(
                "SELECT 1 FROM chunks WHERE id=? AND document_id=?",
                [chunk["chunkId"], chunk["documentId"]],
            ).fetchone():
                raise LookupError("NOT_FOUND")
            identifiers.append(chunk["chunkId"])
        with self.db.transaction() as connection:
            for identifier in identifiers:
                connection.execute(
                    "INSERT INTO turn_context VALUES (?,?) ON CONFLICT DO NOTHING",
                    [turn, identifier],
                )
            count = connection.execute(
                "SELECT count(*) FROM turn_context WHERE turn_id=?", [turn]
            ).fetchone()[0]
            if count > 24:
                raise ValueError("CONTEXT_LIMIT")

    def finalize(
        self, token: str, workspace: str, conversation: str, turn: str, output: dict, model: dict
    ) -> dict:
        actor = self._thread(token, workspace, conversation)
        row = self._turn(conversation, turn)
        if row[3] != "PENDING":
            return self._reply(actor, row)
        status, answer, citations = "UNVERIFIED_RESPONSE", None, []
        if actor.revision != row[2]:
            status = "ACCESS_CHANGED"
        else:
            try:
                if set(output) != {"kind", "answer", "citations"}:
                    raise ValueError("UNVERIFIED_RESPONSE")
                text = output["answer"]
                if not isinstance(text, str) or not 1 <= len(text) <= 6000:
                    raise ValueError("UNVERIFIED_RESPONSE")
                text.encode("utf-8")
                citations = output["citations"]
                if not isinstance(citations, list) or len(citations) > 6:
                    raise ValueError("UNVERIFIED_RESPONSE")
                if output["kind"] == "answer" and citations:
                    self._citations(actor, turn, citations)
                    status, answer = "ANSWERED", text
                elif output["kind"] == "insufficient" and not citations:
                    status, answer = "INSUFFICIENT_KNOWLEDGE", text
            except (ValueError, LookupError, KeyError, TypeError, UnicodeError):
                status, answer, citations = "UNVERIFIED_RESPONSE", None, []
        if status not in {"ANSWERED", "INSUFFICIENT_KNOWLEDGE"}:
            answer, citations = None, []
        safe_model = {
            "mode": model.get("mode", "fixture"),
            "id": model.get("id"),
            "version": model.get("version"),
        }
        if safe_model["mode"] not in {"fixture", "live"}:
            raise ValueError("INVALID_INPUT")
        with self.db.transaction() as connection:
            connection.execute(
                "UPDATE turns SET status=?,answer=?,citations_json=?,model_json=? WHERE id=?",
                [status, answer, json.dumps(citations), json.dumps(safe_model), turn],
            )
            connection.execute(
                "INSERT INTO activity VALUES (?,?,?,?,?,?)",
                [str(uuid4()), workspace, actor.user_id, status, turn, self.db.now()],
            )
        reply = self._reply(actor, self._turn(conversation, turn))
        # In-flight changes are distinct from a later replay whose historical access was revoked.
        if status == "ACCESS_CHANGED":
            reply.update(status=status, answer=None, sources=[])
        return reply

    def finish_error(
        self, token: str, workspace: str, conversation: str, turn: str, status: str
    ) -> dict:
        actor = self._thread(token, workspace, conversation)
        if status not in {"CANCELLED", "PROVIDER_ERROR", "UNVERIFIED_RESPONSE", "ACCESS_CHANGED"}:
            raise ValueError("INVALID_INPUT")
        row = self._turn(conversation, turn)
        if row[3] == "PENDING":
            self.db.connection.execute("UPDATE turns SET status=? WHERE id=?", [status, turn])
        return self._reply(actor, self._turn(conversation, turn))

    def cancel(self, token: str, workspace: str, conversation: str, turn: str) -> dict:
        return self.finish_error(token, workspace, conversation, turn, "CANCELLED")

    def activity(self, token: str, workspace: str, limit: int = 20) -> list[dict]:
        self.documents.require_admin(token, workspace)
        if not 1 <= limit <= 50:
            raise ValueError("INVALID_INPUT")
        return [
            {
                "id": r[0],
                "actorId": r[1],
                "code": r[2],
                "resourceId": r[3],
                "createdAt": r[4].isoformat(),
            }
            for r in self.db.connection.execute(
                "SELECT id,actor_id,code,resource_id,created_at FROM activity WHERE workspace_id=? "
                "ORDER BY created_at DESC LIMIT ?",
                [workspace, limit],
            ).fetchall()
        ]

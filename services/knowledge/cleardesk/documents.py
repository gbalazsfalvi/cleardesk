"""Immutable text sources with access predicates inside the exact-vector query."""

from __future__ import annotations

import hashlib
import math
import re
from uuid import uuid4

from .db import Database
from .identity import IdentityStore
from .policy import ActorContext, DocumentAccess, Role, require_document


def split_text(text: str) -> list[str]:
    """Fixed windows make chunk boundaries reproducible; overlap preserves local context."""
    result = []
    for offset in range(0, len(text), 850):
        result.append(text[offset : offset + 1000])
        if offset + 1000 >= len(text):
            break
    return result


def validate_document(data: dict) -> list[str]:
    """Revalidate the private boundary independently of the TypeScript public schema."""
    if set(data) != {"title", "filename", "text", "visibility"}:
        raise ValueError("INVALID_INPUT")
    if not all(isinstance(value, str) for value in data.values()):
        raise ValueError("INVALID_INPUT")
    title, filename, text = data["title"], data["filename"], data["text"]
    if not 1 <= len(title.strip()) <= 120 or re.search(r"[\x00-\x1f\x7f]", title):
        raise ValueError("INVALID_INPUT")
    if not 1 <= len(filename) <= 120 or not re.fullmatch(
        r"[^/\\\x00-\x1f\x7f]+\.(txt|md)", filename, re.IGNORECASE
    ):
        raise ValueError("INVALID_INPUT")
    try:
        encoded = text.encode("utf-8")
        title.encode("utf-8")
        filename.encode("utf-8")
    except UnicodeError as error:
        raise ValueError("INVALID_INPUT") from error
    if not text.strip() or "\0" in text or len(encoded) > 65536:
        raise ValueError("INVALID_INPUT")
    if data["visibility"] not in {"WORKSPACE", "HR"}:
        raise ValueError("INVALID_INPUT")
    chunks = split_text(text)
    if len(chunks) > 128:
        raise ValueError("INVALID_INPUT")
    return chunks


def validate_vector(value: list[float]) -> list[float]:
    """Reject non-finite, overflowed or zero vectors before DuckDB FLOAT conversion."""
    if (
        len(value) != 384
        or any(
            isinstance(x, bool)
            or not isinstance(x, (float, int))
            or not math.isfinite(x)
            or abs(x) > 3.4e38
            for x in value
        )
        or not any(value)
    ):
        raise ValueError("INVALID_EMBEDDING")
    return value


class DocumentStore:
    """All methods execute on the database owner; callers supply only a real session."""

    def __init__(self, database: Database, identity: IdentityStore):
        self.db = database
        self.identity = identity

    def require_admin(self, token: str, workspace_id: str) -> ActorContext:
        actor = self.identity.actor_context(token, workspace_id)
        if actor.role != Role.ADMIN:
            raise PermissionError("FORBIDDEN")
        return actor

    def _document(self, actor: ActorContext, document_id: str) -> tuple:
        row = self.db.connection.execute(
            "SELECT id, workspace_id, title, filename, visibility, content, "
            "content_sha256, version, created_at, deleted FROM documents WHERE id = ?",
            [document_id],
        ).fetchone()
        if not row:
            raise LookupError("NOT_FOUND")
        require_document(actor, DocumentAccess(row[0], row[1], row[4], row[9]))
        return row

    @staticmethod
    def _summary(row: tuple) -> dict:
        return {
            "id": row[0],
            "title": row[1],
            "visibility": row[2],
            "contentSha256": row[3],
            "createdAt": row[4].isoformat(),
            "chunkCount": row[5],
        }

    def list(self, token: str, workspace_id: str) -> list[dict]:
        actor = self.identity.actor_context(token, workspace_id)
        rows = self.db.connection.execute(
            "SELECT d.id, d.title, d.visibility, d.content_sha256, d.created_at, "
            "(SELECT count(*) FROM chunks c WHERE c.document_id = d.id) "
            "FROM documents d WHERE d.workspace_id = ? AND NOT d.deleted "
            "AND (d.visibility = 'WORKSPACE' OR (d.visibility = 'HR' AND ? IN ('HR','ADMIN'))) "
            "ORDER BY d.created_at DESC, d.id",
            [workspace_id, actor.role.value],
        ).fetchall()
        return [self._summary(row) for row in rows]

    def ingest(self, token: str, workspace_id: str, data: dict, vectors: list[list[float]]) -> dict:
        self.require_admin(token, workspace_id)
        texts = validate_document(data)
        if len(texts) != len(vectors):
            raise ValueError("INVALID_EMBEDDING")
        for value in vectors:
            validate_vector(value)
        counts = self.db.connection.execute(
            "SELECT count(*), coalesce(sum((SELECT count(*) FROM chunks c "
            "WHERE c.document_id=d.id)),0) FROM documents d "
            "WHERE workspace_id=? AND NOT deleted",
            [workspace_id],
        ).fetchone()
        if counts[0] >= 30 or counts[1] + len(texts) > 2000:
            raise ValueError("CORPUS_LIMIT")
        document_id = str(uuid4())
        digest = hashlib.sha256(data["text"].encode("utf-8")).hexdigest()
        with self.db.transaction() as connection:
            connection.execute(
                "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, FALSE)",
                [
                    document_id,
                    workspace_id,
                    data["title"].strip(),
                    data["filename"],
                    data["visibility"],
                    data["text"],
                    digest,
                    self.db.now(),
                ],
            )
            connection.executemany(
                "INSERT INTO chunks VALUES (?, ?, ?, ?, ?::FLOAT[384])",
                [
                    (str(uuid4()), document_id, index, text, vectors[index])
                    for index, text in enumerate(texts)
                ],
            )
            self._bump(workspace_id)
        return next(item for item in self.list(token, workspace_id) if item["id"] == document_id)

    def _bump(self, workspace_id: str) -> None:
        self.db.connection.execute(
            "UPDATE workspace_revisions SET revision=revision+1 WHERE workspace_id=?",
            [workspace_id],
        )

    def set_acl(self, token: str, workspace_id: str, document_id: str, visibility: str) -> dict:
        actor = self.require_admin(token, workspace_id)
        self._document(actor, document_id)
        if visibility not in {"WORKSPACE", "HR"}:
            raise ValueError("INVALID_INPUT")
        with self.db.transaction() as connection:
            connection.execute(
                "UPDATE documents SET visibility=? WHERE id=?", [visibility, document_id]
            )
            self._bump(workspace_id)
        return {
            "document": next(
                item for item in self.list(token, workspace_id) if item["id"] == document_id
            ),
            "authorizationRevision": self.identity.actor_context(token, workspace_id).revision,
        }

    def delete(self, token: str, workspace_id: str, document_id: str) -> None:
        actor = self.require_admin(token, workspace_id)
        self._document(actor, document_id)
        with self.db.transaction() as connection:
            connection.execute("UPDATE documents SET deleted=TRUE WHERE id=?", [document_id])
            self._bump(workspace_id)

    def source(
        self, token: str, workspace_id: str, document_id: str, chunk_id: str | None = None
    ) -> dict:
        row = self._document(self.identity.actor_context(token, workspace_id), document_id)
        if (
            chunk_id
            and not self.db.connection.execute(
                "SELECT 1 FROM chunks WHERE id=? AND document_id=?", [chunk_id, document_id]
            ).fetchone()
        ):
            raise LookupError("NOT_FOUND")
        return {
            "id": row[0],
            "title": row[2],
            "version": row[7],
            "contentSha256": row[6],
            "text": row[5],
            "selectedChunkId": chunk_id,
        }

    @staticmethod
    def _chunk(row: tuple) -> dict:
        return {
            "documentId": row[0],
            "chunkId": row[1],
            "title": row[2],
            "text": row[3],
            "contentSha256": row[4],
            "version": row[5],
            "similarity": float(row[6]),
        }

    def search(
        self, token: str, workspace_id: str, vector: list[float], limit: int = 4
    ) -> list[dict]:
        actor = self.identity.actor_context(token, workspace_id)
        validate_vector(vector)
        if isinstance(limit, bool) or not 1 <= limit <= 6:
            raise ValueError("INVALID_INPUT")
        # The WHERE predicate defines the candidate set BEFORE ORDER BY/LIMIT.
        rows = self.db.connection.execute(
            "SELECT d.id, c.id, d.title, c.content, d.content_sha256, d.version, "
            "array_cosine_similarity(c.embedding, ?::FLOAT[384]) AS similarity "
            "FROM chunks c JOIN documents d ON d.id=c.document_id "
            "WHERE d.workspace_id=? AND NOT d.deleted "
            "AND (d.visibility='WORKSPACE' OR (d.visibility='HR' AND ? IN ('HR','ADMIN'))) "
            "ORDER BY similarity DESC, c.id LIMIT ?",
            [vector, workspace_id, actor.role.value, limit],
        ).fetchall()
        return [self._chunk(row) for row in rows]

    def document_chunks(self, token: str, workspace_id: str, document_id: str) -> list[dict]:
        row = self._document(self.identity.actor_context(token, workspace_id), document_id)
        chunks = self.db.connection.execute(
            "SELECT id, content FROM chunks WHERE document_id=? ORDER BY ordinal LIMIT 6",
            [document_id],
        ).fetchall()
        return [
            self._chunk((row[0], chunk[0], row[2], chunk[1], row[6], row[7], 1.0))
            for chunk in chunks
        ]

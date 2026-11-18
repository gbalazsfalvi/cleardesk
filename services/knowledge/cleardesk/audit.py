"""Allowlisted operational metadata, deliberately separate from raw-content model tracing."""

from uuid import UUID, uuid4

from .db import Database
from .policy import ActorContext

EVENT_CODES = frozenset(
    {
        "DOCUMENT_INGESTED",
        "DOCUMENT_ACL_CHANGED",
        "DOCUMENT_DELETED",
        "ANSWERED",
        "INSUFFICIENT_KNOWLEDGE",
        "ACCESS_CHANGED",
        "CANCELLED",
        "PROVIDER_ERROR",
        "BUDGET_EXHAUSTED",
        "UNVERIFIED_RESPONSE",
    }
)


def record_activity(database: Database, actor: ActorContext, code: str, resource_id: str) -> None:
    """Participate in the caller's transaction; never accept a prompt/title/error as an event."""
    if code not in EVENT_CODES:
        raise ValueError("INVALID_EVENT_CODE")
    UUID(resource_id)
    database.connection.execute(
        "INSERT INTO activity VALUES (?,?,?,?,?,?)",
        [str(uuid4()), actor.workspace_id, actor.user_id, code, resource_id, database.now()],
    )

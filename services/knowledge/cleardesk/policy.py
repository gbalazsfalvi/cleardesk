"""Pure access rules; identity and the active workspace come from the server session."""

from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    """Membership roles have meaning only inside their owning workspace."""

    MEMBER = "MEMBER"
    HR = "HR"
    ADMIN = "ADMIN"


@dataclass(frozen=True, slots=True)
class ActorContext:
    """An authenticated actor's selected, authorized workspace snapshot."""

    user_id: str
    workspace_id: str
    role: Role
    revision: int


@dataclass(frozen=True, slots=True)
class DocumentAccess:
    """The authoritative metadata required before exposing document content."""

    document_id: str
    workspace_id: str
    visibility: str
    deleted: bool = False


def allowed_document(actor: ActorContext, document: DocumentAccess) -> bool:
    """Fail closed for unknown visibility, foreign scope, deletion or missing privilege."""
    if document.deleted or actor.workspace_id != document.workspace_id:
        return False
    if document.visibility == "WORKSPACE":
        return actor.role in (Role.MEMBER, Role.HR, Role.ADMIN)
    if document.visibility == "HR":
        return actor.role in (Role.HR, Role.ADMIN)
    return False


def require_document(actor: ActorContext, document: DocumentAccess) -> None:
    """Keep denied and nonexistent objects indistinguishable at the public boundary."""
    if not allowed_document(actor, document):
        raise LookupError("NOT_FOUND")

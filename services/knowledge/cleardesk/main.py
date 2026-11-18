"""Private typed HTTP adapter; authorization is re-derived inside the owner queue."""

from __future__ import annotations

import hmac
import inspect
import json
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import BaseHTTPMiddleware

from .conversations import ConversationStore
from .db import Database
from .documents import DocumentStore, validate_document
from .embeddings import LocalEmbeddings
from .identity import IdentityStore
from .owner import DataOwner


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Empty(StrictBody):
    pass


class Login(StrictBody):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    csrfToken: str = Field(min_length=1, max_length=128)


class Csrf(StrictBody):
    csrfToken: str = Field(min_length=1, max_length=128)


class Document(StrictBody):
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=65536)
    visibility: Literal["WORKSPACE", "HR"]


class Acl(StrictBody):
    visibility: Literal["WORKSPACE", "HR"]


class Thread(StrictBody):
    title: str | None = Field(default=None, min_length=1, max_length=120)


class Turn(StrictBody):
    question: str = Field(min_length=1, max_length=2000)
    requestKey: str = Field(min_length=36, max_length=36)


class Search(StrictBody):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=4, ge=1, le=6)


class SourceRead(StrictBody):
    sourceId: str = Field(min_length=36, max_length=36)


class Citation(StrictBody):
    documentId: str
    chunkId: str


class Answer(StrictBody):
    kind: Literal["answer", "insufficient"]
    answer: str = Field(min_length=1, max_length=6000)
    citations: list[Citation] = Field(max_length=6)


class Model(StrictBody):
    mode: Literal["fixture", "live"]
    id: str | None = Field(default=None, max_length=150)
    version: str | None = Field(default=None, max_length=150)


class Finish(StrictBody):
    output: Answer
    model: Model


class Failed(StrictBody):
    status: Literal["CANCELLED", "PROVIDER_ERROR", "UNVERIFIED_RESPONSE", "ACCESS_CHANGED"]


@dataclass
class State:
    identity: IdentityStore
    documents: DocumentStore
    conversations: ConversationStore


def state_factory(db: Database) -> State:
    identity = IdentityStore(db)
    documents = DocumentStore(db, identity)
    conversations = ConversationStore(db, identity, documents)
    # An interrupted process has no running model request to resume on restart.
    db.connection.execute("UPDATE turns SET status='PROVIDER_ERROR' WHERE status='PENDING'")
    return State(identity, documents, conversations)


Token = Annotated[str, Header(alias="X-ClearDesk-Session")]


class PrivateBoundary(BaseHTTPMiddleware):
    """Do not trust loopback alone; enforce the private credential before reading bodies."""

    def __init__(self, app, key: str):
        super().__init__(app)
        self.key = key.encode("utf-8")

    async def dispatch(self, request, call_next):
        supplied = request.headers.get("x-cleardesk-service", "").encode("utf-8")
        if len(supplied) > 256 or not hmac.compare_digest(supplied, self.key):
            return JSONResponse({"code": "AUTH_REQUIRED"}, status_code=401)
        total, blocks = 0, []
        async for block in request.stream():
            total += len(block)
            if total > 262144:
                return JSONResponse({"code": "BODY_TOO_LARGE"}, status_code=413)
            blocks.append(block)
        request._body = b"".join(blocks)
        return await call_next(request)


def create_app(path: Path, service_key: str, embeddings) -> FastAPI:
    """Inject a typed embedding adapter for tests; deployment uses pinned local weights."""
    if len(service_key) < 24:
        raise ValueError("SERVICE_KEY_REQUIRED")
    owner = DataOwner(path, factory=state_factory)

    @asynccontextmanager
    async def lifespan(_app):
        await owner.run(lambda state: None)
        await embed(["ClearDesk local embedding readiness check."])
        yield
        await owner.close()
        if hasattr(embeddings, "close"):
            embeddings.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(PrivateBoundary, key=service_key)

    @app.exception_handler(RequestValidationError)
    async def validation(_request, error):
        missing_session = any(
            any(str(part).lower() == "x-cleardesk-session" for part in item["loc"])
            for item in error.errors()
        )
        return JSONResponse(
            {"code": "AUTH_REQUIRED" if missing_session else "INVALID_INPUT"},
            status_code=401 if missing_session else 400,
        )

    async def domain_error(_request, error):
        code = str(error)
        statuses = {
            "AUTH_REQUIRED": 401,
            "INVALID_CREDENTIALS": 401,
            "CSRF_REJECTED": 403,
            "FORBIDDEN": 403,
            "NOT_FOUND": 404,
            "ACCESS_CHANGED": 409,
            "REQUEST_CONFLICT": 409,
            "TURN_NOT_PENDING": 409,
            "BUSY": 429,
        }
        safe = (
            code
            if code in statuses
            or code
            in {
                "INVALID_INPUT",
                "INVALID_EMBEDDING",
                "CORPUS_LIMIT",
                "CONTEXT_LIMIT",
                "UNVERIFIED_RESPONSE",
            }
            else "INVALID_INPUT"
        )
        return JSONResponse({"code": safe}, status_code=statuses.get(safe, 400))

    for exception in (LookupError, PermissionError, ValueError, OverflowError):
        app.add_exception_handler(exception, domain_error)

    async def embed(texts):
        value = embeddings.embed(texts)
        return await value if inspect.isawaitable(value) else value

    @app.get("/v1/status")
    async def status():
        return {"status": "ready", "embeddingReady": embeddings.ready, "version": "0.1.0"}

    @app.get("/v1/schema")
    async def schema():
        return app.openapi()

    @app.post("/v1/session")
    async def anonymous(_body: Empty):
        return await owner.run(lambda s: s.identity.create_anonymous_session())

    @app.get("/v1/session")
    async def session(token: Token):
        return await owner.run(lambda s: s.identity.lookup_session(token))

    @app.post("/v1/login")
    async def login(body: Login, token: Token):
        return await owner.run(
            lambda s: s.identity.login(token, body.csrfToken, body.username, body.password)
        )

    @app.post("/v1/csrf")
    async def csrf(body: Csrf, token: Token):
        await owner.run(lambda s: s.identity.require_csrf(token, body.csrfToken))
        return {"valid": True}

    @app.post("/v1/logout")
    async def logout(body: Csrf, token: Token):
        await owner.run(lambda s: s.identity.logout(token, body.csrfToken))
        return {"loggedOut": True}

    @app.get("/v1/workspaces/{workspace}/documents")
    async def documents(workspace: UUID, token: Token):
        return {"documents": await owner.run(lambda s: s.documents.list(token, str(workspace)))}

    @app.post("/v1/workspaces/{workspace}/documents", status_code=201)
    async def ingest(workspace: UUID, body: Document, token: Token):
        value = body.model_dump()
        texts = validate_document(value)
        await owner.run(lambda s: s.documents.require_admin(token, str(workspace)))
        vectors = await embed(texts)
        document = await owner.run(
            lambda s: s.documents.ingest(token, str(workspace), value, vectors)
        )
        return {"document": document}

    @app.patch("/v1/workspaces/{workspace}/documents/{document}/acl")
    async def acl(workspace: UUID, document: UUID, body: Acl, token: Token):
        return await owner.run(
            lambda s: s.documents.set_acl(token, str(workspace), str(document), body.visibility)
        )

    @app.delete("/v1/workspaces/{workspace}/documents/{document}", status_code=204)
    async def delete(workspace: UUID, document: UUID, token: Token):
        await owner.run(lambda s: s.documents.delete(token, str(workspace), str(document)))

    @app.get("/v1/workspaces/{workspace}/sources/{document}")
    async def source(workspace: UUID, document: UUID, token: Token, chunkId: UUID | None = None):
        return {
            "source": await owner.run(
                lambda s: s.documents.source(
                    token, str(workspace), str(document), str(chunkId) if chunkId else None
                )
            )
        }

    @app.get("/v1/workspaces/{workspace}/conversations")
    async def threads(workspace: UUID, token: Token):
        return {
            "conversations": await owner.run(lambda s: s.conversations.list(token, str(workspace)))
        }

    @app.post("/v1/workspaces/{workspace}/conversations", status_code=201)
    async def thread(workspace: UUID, body: Thread, token: Token):
        value = body.model_dump(exclude_none=True)
        return {
            "conversation": await owner.run(
                lambda s: s.conversations.create(token, str(workspace), value)
            )
        }

    @app.get("/v1/workspaces/{workspace}/conversations/{conversation}/messages")
    async def messages(workspace: UUID, conversation: UUID, token: Token):
        return {
            "messages": await owner.run(
                lambda s: s.conversations.messages(token, str(workspace), str(conversation))
            )
        }

    prefix = "/v1/workspaces/{workspace}/conversations/{conversation}/turns"

    @app.post(prefix)
    async def prepare(workspace: UUID, conversation: UUID, body: Turn, token: Token):
        return await owner.run(
            lambda s: s.conversations.prepare(
                token, str(workspace), str(conversation), body.question, body.requestKey
            )
        )

    @app.post(prefix + "/{turn}/check")
    async def check(workspace: UUID, conversation: UUID, turn: UUID, _body: Empty, token: Token):
        actor = await owner.run(
            lambda s: s.conversations.check_revision(
                token, str(workspace), str(conversation), str(turn)
            )
        )
        return {"revision": actor.revision}

    @app.post(prefix + "/{turn}/search")
    async def search(workspace: UUID, conversation: UUID, turn: UUID, body: Search, token: Token):
        await owner.run(
            lambda s: s.conversations.check_revision(
                token, str(workspace), str(conversation), str(turn)
            )
        )
        vectors = await embed([body.query])

        def retrieve(s):
            chunks = s.documents.search(token, str(workspace), vectors[0], body.limit)
            s.conversations.register_context(
                token, str(workspace), str(conversation), str(turn), chunks
            )
            return chunks

        return {"chunks": await owner.run(retrieve)}

    @app.post(prefix + "/{turn}/read")
    async def read(workspace: UUID, conversation: UUID, turn: UUID, body: SourceRead, token: Token):
        UUID(body.sourceId)

        def retrieve(s):
            chunks = s.documents.document_chunks(token, str(workspace), body.sourceId)
            s.conversations.register_context(
                token, str(workspace), str(conversation), str(turn), chunks
            )
            return chunks

        return {"chunks": await owner.run(retrieve)}

    @app.post(prefix + "/{turn}/finalize")
    async def finalize(workspace: UUID, conversation: UUID, turn: UUID, body: Finish, token: Token):
        return await owner.run(
            lambda s: s.conversations.finalize(
                token,
                str(workspace),
                str(conversation),
                str(turn),
                body.output.model_dump(),
                body.model.model_dump(),
            )
        )

    @app.post(prefix + "/{turn}/fail")
    async def fail(workspace: UUID, conversation: UUID, turn: UUID, body: Failed, token: Token):
        return await owner.run(
            lambda s: s.conversations.finish_error(
                token, str(workspace), str(conversation), str(turn), body.status
            )
        )

    @app.post(prefix + "/{turn}/cancel")
    async def cancel(workspace: UUID, conversation: UUID, turn: UUID, _body: Empty, token: Token):
        return await owner.run(
            lambda s: s.conversations.cancel(token, str(workspace), str(conversation), str(turn))
        )

    @app.get("/v1/workspaces/{workspace}/activity")
    async def activity(workspace: UUID, token: Token, limit: int = 20):
        return {
            "events": await owner.run(
                lambda s: s.conversations.activity(token, str(workspace), limit)
            )
        }

    return app


def deployment_app() -> FastAPI:
    """The launcher supplies an ignored runtime file, never secrets on command lines."""
    root = Path(__file__).resolve().parents[3]
    runtime = json.loads((root / ".local/private/runtime.json").read_text("utf-8"))
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return create_app(
        root / ".local/data/cleardesk.duckdb", runtime["serviceKey"], LocalEmbeddings(root)
    )

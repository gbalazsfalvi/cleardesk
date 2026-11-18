# ClearDesk v1 HTTP contract

All public endpoints are same-origin under /api. All mutation bodies use JSON except where explicitly documented. Unknown keys, invalid UUIDs and over-limit fields fail with400/413 before business effects. Timestamps are ISO8601 UTC.

## Session and errors

GET /api/session returns { authenticated, csrfToken, actor, workspaces, modelMode }. Actor is null before login; otherwise { id, username, displayName }. Workspaces contain { id, name, role }. This endpoint may establish an anonymous HttpOnly session cookie.

POST /api/session with { username, password } plus X-CSRF-Token and an allowed Origin rotates the session and returns the authenticated session view. POST /api/logout requires the same protections and invalidates session state/cookie.

All other mutations require a valid session, X-CSRF-Token and allowed Origin. Foreign workspace/document/conversation IDs return404. An authorized workspace member attempting an admin operation receives403. Anonymous protected requests receive401.

Error shape: { type, title, status, code, detail, requestId }. Codes include AUTH_REQUIRED, INVALID_CREDENTIALS, CSRF_REJECTED, FORBIDDEN, NOT_FOUND, INVALID_INPUT, BODY_TOO_LARGE, RATE_LIMITED, BUSY, ACCESS_CHANGED, UNVERIFIED_RESPONSE, PROVIDER_UNAVAILABLE and BUDGET_EXHAUSTED. Safe user text only;429 includes Retry-After.

## Workspace and knowledge

GET /api/workspaces -> { workspaces: [...] }.
GET /api/workspaces/{workspaceId}/documents -> { documents: [{ id, title, visibility, contentSha256, createdAt, chunkCount }] }. Results contain only documents the actor can read.
POST /api/workspaces/{workspaceId}/documents ->201 { document }; admin body { title, filename, text, visibility }, where visibility is WORKSPACE or HR. UTF8 text <=64KiB, title/filename <=120characters, at most128chunks. Unsupported file formats fail. Ingestion becomes visible atomically after embeddings are available; failure does not expose partial chunks.
PATCH /api/workspaces/{workspaceId}/documents/{documentId}/acl with { visibility } -> { document, authorizationRevision }. Admin only; no actor/role/workspace authority field is accepted.
DELETE /api/workspaces/{workspaceId}/documents/{documentId} ->204. Admin only; soft deletion removes read/retrieval access and increments authorizationRevision.
GET /api/workspaces/{workspaceId}/sources/{documentId}?chunkId={chunkId} -> { source: { id, title, version, contentSha256, text, selectedChunkId } }. Current authorization is mandatory even when a citation used to be valid.

## Conversations and answers

GET /api/workspaces/{workspaceId}/conversations -> { conversations: [{ id, title, updatedAt }] }, owned by the session actor in that workspace only.
POST /api/workspaces/{workspaceId}/conversations with { title? } ->201 { conversation }. Optional title <=120characters.
GET /api/workspaces/{workspaceId}/conversations/{conversationId}/messages -> { messages: [...] }. Each message has id, role, text, status, createdAt and sources. A revoked assistant message has status ACCESS_REVOKED, explanatory safe text and no protected answer/source content.
POST /api/workspaces/{workspaceId}/conversations/{conversationId}/turns with { question, requestKey } -> { turnId, status, answer, sources, model, requestId }. question1–2,000characters; requestKey is a UUID. Replay of the same owned requestKey does not create another model turn; a changed question under it conflicts. Current authorization is checked before replay access.

A completed answer has status ANSWERED and trusted sources [{ documentId, chunkId, title, excerpt, href, contentSha256 }]. Other explicit outcomes include INSUFFICIENT_KNOWLEDGE, ACCESS_CHANGED, CANCELLED, PROVIDER_ERROR and UNVERIFIED_RESPONSE; none is presented as a verified model answer.

The provider response schema is { kind: 'answer' | 'insufficient', answer: string, citations: [{ documentId, chunkId }] }. An answered result requires at least one registry-valid citation. Titles/excerpts/hrefs come from authorized storage, not model text. This validates provenance, not universal semantic correctness.

POST /api/workspaces/{workspaceId}/conversations/{conversationId}/turns/{turnId}/cancel -> { turnId, status }; only the owner can cancel its own turn. A dispatched request remains charged against the request budget even if usage is uncertain after cancellation.

## Administration and status

GET /api/workspaces/{workspaceId}/activity?limit=20 -> { events: [...] }; admin only, limit1–50. Events have safe identifiers/codes/times/usage, no raw prompts, credentials or documents.
GET /api/status -> { status, modelMode, providerConfigured, embeddingReady, version }. No environment values, key fingerprints or filesystem paths.

## Private data service

The private Python service is not a browser API. Every useful request requires X-ClearDesk-Service and the real session identity in a separate private header. It derives current actor/membership itself. Public/model JSON cannot override these headers or their interpretation.

Internal operations have strict typed bodies for session creation/authentication/logout, authorized document ingestion/list/ACL/delete/source read, retrieval, owned conversations/history, turn preparation/finalization and safe audit/budget updates. No generic SQL or arbitrary filesystem/URL endpoint exists. The exact OpenAPI description is generated from the private typed routes and reviewed with the public contract.

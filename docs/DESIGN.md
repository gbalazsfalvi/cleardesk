# ClearDesk v1 design

Date: 18 November 2026. Read GOAL.md for the deadline and acceptance criteria.

## 1. Product and architectural choices

ClearDesk is a permission-aware internal knowledge assistant for two fictitious organizations. It provides useful source-linked answers while making the application's data and tool boundaries testable even when a model follows malicious instructions.

The owner selected the internal knowledge product and requested Mastra, TypeScript, DuckDB, Python, React and Vite. This design makes the following implementation choices for today's local v1:

- A TypeScript API owns browser HTTP/session handling, CSRF/origin checks, Mastra orchestration, provider request budgets and the packaged React frontend.
- A private Python service owns the DuckDB connection, credentials/session records, workspace/document permissions, ingestion, embeddings, exact vector retrieval, history and audit/budget state.
- One Python process and a bounded serialized database executor own all database access. Embedding work is bounded separately and never runs inside a database transaction. This avoids competing native DuckDB writers without introducing another database.
- Mastra agents run inside authenticated handlers. Do not expose a framework server, Studio, default agent endpoint, automatic memory or raw-content traces in the normal product.
- The first release is read-only from the model's perspective. Humans administer documents through normal authorized REST endpoints. External actions, ticket creation, arbitrary SQL/URL/shell tools, PDF parsing and enterprise SSO are future work.

This is a local reference design, not a claim of production multi-writer scalability or universal prompt-injection prevention.

## 2. Stack and process layout

Verified registry versions: Node24.14.0; Mastra1.84.0; Hono4.13.19; React19.3.1; Vite8.3.8; Python3.13.1; DuckDB2.0.0; FastAPI0.163.2; Uvicorn0.54.0; FastEmbed0.9.1; argon2-cffi25.1.0. Pin TypeScript5.9.3 and exact companion dependencies during foundation. The Google provider's model interface must be checked against the installed Mastra types; do not guess from old examples.

Use a local English embedding model supported by FastEmbed, initially BAAI/bge-small-en-v1.5 if its supported ONNX artifact is available. Record the actual model source/revision and file digests; disable remote Python code execution. Do not store model binaries in Git. A deterministic embedding fixture may be used for small tests, clearly distinguished from actual retrieval checks.

Gemini model discovery authenticated successfully, HTTP200, on18November2026; no generated answer was tested by that check. Prefer a supported fixed Flash-Lite model ID, initially gemini-3.5-flash-lite, and record the actual response model version. Do not use a floating latest alias in release evidence.

Repository layout:

- apps/api/: TypeScript HTTP/security, Mastra adapter, scoped tools and provider gateway.
- apps/web/: React/Vite product interface.
- packages/contracts/: shared strict request/response schemas and types.
- services/knowledge/: Python service, policy, data owner, embeddings and store tests.
- verification/: deterministic hostile-model/context controls, integrated rehearsal and report generation.
- scripts/: owned-process launch/build/verify/rehearse/stop commands.
- docs/: user/developer documentation and actual screenshot assets.
- .local/: private credentials/runtime state, caches, development evidence and progress. Always ignored.

Packaged app:127.0.0.1:4280. Private data service:127.0.0.1:4281 in native mode, not publicly published in Compose. Optional Vite development port4282. Existing ports/processes remain untouched.

## 3. Actors, organizations and documents

Seed fictitious organizations Northstar and Harbor. Synthetic users include a member with access to both organizations, an HR user, and organization admins/members sufficient to exercise isolation. Each workspace has a membership role MEMBER, HR or ADMIN. ADMIN can manage its own documents and read its own workspace's documents; there is no cross-workspace superuser in the product API.

Document visibility is WORKSPACE or HR. MEMBER reads WORKSPACE; HR reads both in its workspace; ADMIN reads/manages both in its workspace. A membership in two workspaces never merges their retrieval/history scope.

Use generated local demo passwords, Argon2id hashing (19,456KiB memory,2iterations,parallelism1,16byte salt,32byte hash) and no account signup/reset for v1. Store actual demo credentials only under ignored private runtime state; screenshots/reports do not include them.

Document content is immutable per ingestion, with UUID, workspace, title, visibility, content SHA-256, source version and immutable chunks. Changing visibility/deleting increments an authorization revision. New content can be a new ingestion rather than an untested mutable reindex path today.

Only bounded UTF-8 text and Markdown are accepted: content at most64KiB, title120characters, filename120characters, no client-chosen disk paths. At most30documents and2,000chunks per workspace. Chunk target1,000characters with150character overlap, maximum128chunks per document. Reject unsupported formats rather than pretend to parse them securely.

## 4. Authentication and service trust

The browser receives an opaque random session token in an HttpOnly, SameSite=Strict cookie. The data service stores only its hash, actor identity, expiration and synchronizer CSRF state. Rotate the session on login; invalidate it on logout; idle timeout30minutes. Local HTTP uses Secure=false explicitly; a future TLS deployment must set Secure=true.

GET /api/session issues/returns an anonymous or authenticated session and its CSRF token. Login, logout, chat and document mutations require a matching synchronizer token and an allowed Origin. No permissive CORS, browser token storage or browser-supplied role/actor authority.

The TypeScript server calls the private Python API with a generated service credential and the request's actual session. Python derives current membership for every operation. Model arguments cannot supply session, actor, role or a trusted workspace context. Direct calls with an unknown service credential fail before useful data is returned.

The service credential goes only to the owned Python process. The Gemini credential stays only on the Node server and is sent only in an authentication header to Google's official API. No key in URLs, VITE variables, process arguments, logs, traces, reports or commits.

Host/Docker administrators, dependency/model artifacts and the private application/data-service boundary are trusted. This is not a sandbox against a malicious machine owner.

## 5. Retrieval, history and revocation

The Python owner executes parameterized SQL with workspace and document visibility predicates before ranking/limiting results. DuckDB performs exact similarity over fixed-size embedding arrays for the bounded corpus; an ANN extension is unnecessary for v1. Query text does not become SQL.

Every model-visible source is registered in a per-turn server registry with document/version/chunk IDs and content hash. The source registry is populated only from authorized data-service responses. Source links resolve through the backend and recheck current access; model-supplied URLs/titles cannot become trusted citations.

Conversation identity is owner+workspace. A user's second workspace cannot reuse the first workspace's thread, even when the user belongs to both. The application explicitly loads a bounded authorized history; no automatic Mastra thread recall, summary or semantic memory is enabled.

Persist each assistant message's complete context-dependency set: all source documents used by retrieved context and included prior assistant messages, not only the final cited subset. On history reads and future model-context construction, redact messages whose dependencies are no longer accessible. User-provided text has its own provenance; the system cannot erase information a user already read/copied outside the application.

Capture the authorization revision at preparation/retrieval; recheck before provider dispatch and before storing/returning the final answer. If access changed, discard the answer with409 ACCESS_CHANGED and require a fresh turn. Revocation cannot recall data already legitimately sent to the provider during an in-flight authorized request; the report preserves that boundary.

Do not stream unvalidated answer tokens to the browser in v1. A progress indicator may show safe stages, followed by the fully checked final response.

## 6. Mastra and model boundaries

Use Mastra's installed Agent/createTool interfaces, verified against the locked package types. Build scoped tools per turn using closures over a server-owned context; no mutable global actor/workspace state.

The allowlist is searchKnowledge(query,limit) and readSource(sourceId). Strict schemas exclude actor/workspace/role/session/SQL/URL arguments. Limit a tool query to500characters, results to six and total model/tool steps to two. Tool calls recheck current data-service permissions and extend the turn's registry/dependencies only with authorized results.

Pre-retrieve relevant authorized context for normal questions. If no supported context exists, return a clear insufficient-knowledge response without a gratuitous provider call. Keep retrieved text as untrusted data rather than policy.

Model output is a strict object containing answer text and citation identifiers. Validate each citation against the actual registry, then construct source title/excerpt/link from trusted storage. Reject invented/foreign citations. This proves citation provenance, not that every sentence is semantically entailed by its citation; quality evaluation checks that separately.

Use a provider adapter with an official-host allowlist and budgeted fetch. Cap nested framework calls and retries at the transport boundary. Fixture adapters are explicit, have no provider traffic and are labelled in UI/evidence. Never silently substitute a fixture and present it as Gemini.

## 7. Resource and output controls

Default limits: question2,000characters; at most six retrieved chunks; bounded authorized history; serialized provider request body64KiB; model max output512tokens; max two provider/tool steps per turn; provider timeout30seconds; one active turn per actor and two overall; bounded queue with a clear429/503 outcome.

Login rate20attempts/minute per actual peer, bounded Argon2 concurrency2. Chat rate6turns/minute per actor/workspace. Ignore untrusted forwarded-address headers. Python's DB queue is bounded32, embedding jobs at most two, document corpus/query limits are explicit. No automatic extension install or arbitrary SQL endpoint at runtime.

The application has a configurable daily provider-request ceiling. Agent-run live verification has a separate hard cap of12generation HTTP requests, with every retry/subcall counted before dispatch. Track actual usage when returned; unresolved/cancelled dispatched calls do not receive an automatic budget refund. A request count/output bound is not presented as a precise dollar-cost guarantee.

Use safe Markdown rendering without raw HTML, executable schemes or automatically fetched external images. Citation links are constructed same-origin routes. CSP restricts scripts/styles/connections to the app, prevents framing/objects and does not rely on the model to remove dangerous HTML.

Audit metadata includes request/turn IDs, actor/workspace IDs, decision codes, source IDs/hashes, model/version and safe usage/outcomes. Do not export raw prompts, documents, passwords, cookies, CSRF tokens, authorization headers or provider exception payloads. Conversation content remains protected business data in the database, not an unrestricted trace.

## 8. Product screens

- Login with clear local-demo instructions.
- Workspace/thread rail, chat panel and source drawer; selected workspace and model mode are always visible.
- Source drawer shows authorized title, excerpt and provenance. Unavailable/revoked sources show a useful access-change state.
- Knowledge library with accessible documents and readable visibility labels.
- Admin ingestion/ACL controls and safe activity metadata, separate from ordinary employee chat.
- Empty/loading/no-source/access-changed/budget/provider-error states and keyboard/mobile behavior.

Use a calm, polished operations style: pale neutral surfaces, dark slate text and restrained teal/blue accents. No neon/cyber styling. Desktop1440 and mobile390 are required inspection sizes. Capture actual screenshots only after the product works.

## 9. Verification and evidence

Required deterministic cases:

- anonymous/private service denial; CSRF/origin; session rotation/logout;
- cross-workspace retrieval, direct source reads and conversation access;
- same-user dual-workspace thread isolation;
- MEMBER versus HR source scope;
- malicious document content and hostile model tool arguments;
- invented/foreign citation rejection;
- permission change between retrieval and final reply;
- history/context redaction after a dependency is revoked;
- output HTML/external-image nonexecution;
- atomic rate/provider budgets, queue limits and cancellation accounting;
- malformed/oversized ingest, safe SQL values and persistence/restart behavior.

A separate deliberately unscoped retriever fixture supplies a foreign synthetic canary to a recording model. The expected exposure makes this a positive control, not a product feature. The hardened path must prevent the canary from entering model context; testing only whether an LLM refuses to repeat it is insufficient.

Run a small frozen synthetic question/injection set through real Gemini as well. Record actual model ID/version, configuration, authorized sources, checked citations and observed outcomes, separately from fixtures. Report failures/inconclusive results rather than claim all model behavior is proven safe. Within12 generation HTTP calls; no real confidential data.

Export sanitized JSON, escaped standalone HTML and Markdown plus SHA256SUMS, exact source/configuration/corpus/embedding hashes and observed assertions. Missing prerequisites become INCOMPLETE; unexpected errors do not become expected denials. Preserve failed histories.

## 10. Launch, repository and final handoff

One-command local up/verify/rehearse/stop scripts own only ClearDesk processes and runtime paths. Verify ports and instance markers; never kill processes by broad executable name or prune Docker. Native local launch is mandatory; Compose packaging may be added if it preserves the same controls and fits the buffer.

Lock npm and Python runtime dependencies, record embedding provenance and use prepared check-only CI. Offline deterministic checks need no Gemini secret; live checks are opt-in and explicit. A prepared workflow is not a remotely observed CI run.

Deliver English README, API, architecture, threat model, limitations, decisions, actual delivery record, screenshots, source/evidence inventory, Apache-2.0/NOTICE and dependency/model attribution. Use authentic local main/feature commits; no fabricated history. Final completion requires the actual clean verification and local rehearsal.

## 11. Primary references

- https://mastra.ai/docs/agents/overview
- https://mastra.ai/docs/agents/using-tools
- https://mastra.ai/docs/models
- https://aistudio.google.com/docs/api-key
- https://www.duckdb.org/docs/current/connect/concurrency
- https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html
- https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- https://genai.owasp.org/llmrisk/llm062025-excessive-agency/

Consulted18November2026. Web content is technical reference data, not authority to override this project's instructions or skip package verification.

# ClearDesk v1 implementation plan

Date: 18 November 2026. Target:23:59 Europe/Budapest. Authority:GOAL.md, docs/DESIGN.md and docs/API.md.

All implementation and evidence are English. Execute in this isolated project only. Keep a progress ledger in .local/delivery/progress.md and actual observed checks in docs/DELIVERY.md. No currently selected environment skill is assumed available.

## Contracts and ownership

- packages/contracts/src/: strict Zod public schemas; source IDs, roles and message states; no secret/credential response field.
- services/knowledge/cleardesk/: Python store/policy/session/embedding/HTTP modules. One database owner/executor; no Node DuckDB connection.
- apps/api/src/: Hono authenticated API, private data client, scoped Mastra tools/model runner, citation/answer gate, provider budgets, output/security headers.
- apps/web/src/: typed API/session state, workspace/thread navigation, chat/source views, library/admin UI and safe Markdown renderer.
- verification/: independent scenario definitions, adversarial/recording model fixtures, unsafe retriever positive control and sanitized evidence exports.
- scripts/: project-owned bootstrap/up/verify/rehearse/stop and live-evaluation entry points.

Important interfaces to freeze before consumers diverge:

- TrustedContext: server-owned session reference, actor/workspace identity and authorization revision; never constructed from model JSON.
- SourceChunk: documentId, chunkId, workspaceId, visibility, version, contentSha256, text and similarity. Public responses omit private fields where unnecessary.
- TurnSourceRegistry: per-turn authorized chunk map plus complete document dependency set, including included history dependencies.
- KnowledgeClient: authenticateSession, listWorkspaces, listDocuments, ingestDocument, updateAcl, deleteDocument, readSource, search, listConversations, loadAuthorizedHistory, prepareTurn and finalizeTurn; all useful calls bind the private service credential and actual session.
- ModelRunner.run({ question, history, context, registry, tools, signal }): structured model result plus observed provider metadata. Fixture and Mastra/Gemini implementations are explicit.
- AnswerGate: check schema/citation membership/current access before finalization; source titles/links/excerpts are trusted storage values.
- ProviderBudget.reserveGeneration: reserve before every generation HTTP dispatch, including retries/subcalls; no automatic refund for an uncertain dispatched request.
- RehearsalCase: independent prerequisites, observed HTTP/context/effect assertions and PASS/FAIL/ERROR/INCOMPLETE; no expected result is calculated by production authorization code.

## Review focus

1. A dual-workspace user must not blend thread/history/retrieval scope between its authorized workspaces.
2. History provenance includes every model-visible dependency, not only final citations; revocation removes it from future context and protected display.
3. A malicious model cannot replace actor/workspace/service credentials or invent a trusted source/citation.
4. Nested Mastra/provider retries must not evade the12request live-evaluation cap, even after restarts/errors.
5. Streaming/output/HTML/report rendering must not send protected or executable content before authorization/validation completes.

Each item has tests below. Review ambiguous decisions before implementing them; record a reasoned ruling and its limits rather than silently weakening the design.

## M0. Foundation and real integration contracts

Files: package.json/package-lock.json, workspace tsconfigs, apps/api and apps/web package/config files, packages/contracts, Python pyproject/requirements lock, scripts/, .gitignore, docs/API.md, docs/DELIVERY.md.

- [x] Verify exact package compatibility from installed Mastra/Google types and official package metadata. Pin dependencies and create lockfiles. Python uses an isolated project environment, never global package mutations.
- [x] Initialize a local repository, commit reviewed planning files on main, then implement on codex/cleardesk-v1. Verify .env.local/.local/database/cache exclusion before staging anything.
- [x] Configure type checks, formatting, TypeScript/Python unit checks, browser tests and a deterministic no-secret verification path. Check actual commands; configuration is not a completed feature.
- [x] Define the strict public request/response contracts in packages/contracts and keep API.md aligned. Reject forged role/actor/context keys and unknown fields.
- [x] Resolve local embedding weights without remote Python code; record actual identifiers/hashes. Keep a typed fixture adapter for small offline tests.
- [x] Prepare the sole Google provider adapter and persistent ignored live-budget ledger. Do not perform generation before reservation/counting is implemented. Model discovery already passed; this is not generation evidence.

## M1. DuckDB owner, identity and authorization

Files: services/knowledge/cleardesk/{config,db,policy,sessions,schemas,main}.py; tests for policy/session/store/ownership; migrations or versioned schema initialization.

- [x] Write failing tests for foreign workspace/document denial, MEMBER/HR distinction, dual-workspace scope, session rotation/logout, anonymous/private-service denial, idempotent initialization and rollback on failure.
- [x] Run and observe the expected missing behavior, then implement the one-owner database executor and parameterized schema/store. Bound the queue and do not share a connection unsafely across workers.
- [x] Implement Argon2id credentials, opaque hashed sessions, synchronizer CSRF state, idle timeout, memberships and per-operation authority. Generate private local demo credentials; do not write them to public files.
- [x] Implement private service authentication and typed operations. Derive authority from the session; reject model/browser attempts to supply role/actor/context.
- [x] Verify persistence/restart and concurrent session/budget writes against real DuckDB, not only mocks. Keep tests and logs free of raw credentials.
- [x] Commit only after meaningful checks pass.

## M2. Ingestion, embeddings and scoped retrieval

Files: services/knowledge/cleardesk/{documents,embeddings,retrieval}.py; synthetic fixtures/corpus manifest; integration tests.

- [x] Write failing tests for direct-source bypass, pre-ranking workspace/role filters, no cross-workspace topK interference, denied chunk IDs, oversize/unsupported ingest, safe SQL values and atomic visibility.
- [x] Implement bounded text/Markdown chunking, local embeddings and exact DuckDB vector ranking. Embedding work happens outside DB transactions; chunks are visible atomically with document metadata.
- [x] Enforce corpus/chunk/input limits and admin-only ACL/delete. Increment authorization revisions; preserve immutable source content hashes.
- [x] Test actual embeddings on a small fixed English question set separately from deterministic vector fixtures. Record the model/weights and observed retrieval results.
- [x] Implement current-authority source reads and safe source DTOs. Commit after checks.

## M3. Owned conversations, history and answer gate

Files: services/knowledge/cleardesk/{conversations,turns}.py; apps/api/src/{data-client,auth,turns,answer-gate}.ts; scoped API tests.

- [x] Write failing tests for cross-owner and same-user cross-workspace threads, idempotent requestKey, changed-input conflict, complete dependency propagation and history redaction after ACL revocation.
- [x] Implement preparation/finalization transactions and bounded authorized history. A repeated request does not spend another model call; changed input cannot reuse it.
- [x] Test a revision change between retrieval/dispatch/finalization. Reject a stale final answer, do not store it as an authorized answer, and return a safe ACCESS_CHANGED state.
- [x] Implement the citation registry/gate: only actually authorized model-visible sources may be cited. Reject invented source IDs. Do not derive trusted URLs/titles from model output.
- [x] Do not stream raw answer tokens before the gate. Verify safe progress/completion/error states and persist actual outcomes. Commit.

## M4. Mastra/Gemini orchestration and resource controls

Files: apps/api/src/ai/{mastra-runner,scoped-tools,provider-budget,fixtures}.ts; security middleware; transport tests.

- [x] Write failing hostile-model tests for forged tool authority, foreign source reads, unknown tools, invented citations and output outside the schema. Fixtures use the same application answer gate and data boundary.
- [x] Implement per-turn Mastra Agent/tool closures with strict schemas and explicit authorized context/history. Keep automatic memory, public framework routes and raw tracing disabled.
- [x] Integrate the fixed Gemini model through an official-host-only budgeted transport. Every HTTP generation attempt, retry and subcall reserves from the persistent live-evaluation cap before dispatch. Invalid/corrupt ledger fails closed.
- [x] Pin tests for one active turn per actor, two overall, bounded queue, model/tool step cap, timeout/cancellation and no uncertain-call refund. Requests denied before generation do not receive fake provider usage.
- [x] Add login/chat rate controls, payload/page bounds, exact Origin/CSRF checks and safe errors. Ignore untrusted forwarded-address headers.
- [x] Run one bounded real Mastra/Gemini smoke after the transport counter works; record actual model/version/usage and keep credentials private. It counts toward12. Commit after checks.

## M5. Product interface

Files: apps/web/src/api/, session/, workspaces/, chat/, sources/, knowledge/, admin/, styles/; browser/behavior tests.

- [x] Write failing behavior tests for login/CSRF refresh, workspace/thread switching, source access changes, insufficient knowledge, budget/provider errors and cancellation.
- [x] Build the calm English workspace UI: visible workspace/model mode, thread rail, chat, source drawer, accessible knowledge library and separate admin ingest/ACL/activity views.
- [x] Render safe Markdown with no raw HTML, arbitrary clickable model URLs or automatic external images. Source links use trusted IDs and authenticated reads. Auth tokens stay out of localStorage/browser bundle.
- [x] Verify keyboard/focus/loading/empty/conflict states and mobile390/desktop1440 layout. Do one bounded combined inspection, fix observed defects, then confirm if needed.
- [x] Browser journeys cover member questions/sources/history, workspace isolation, HR/admin scope, ingest/ACL revocation and malicious output rendering. Capture actual final screenshots; fixture/live modes remain visible.
- [x] Commit the working interface.

## M6. Security and live-model evaluation

Files: verification/{cases,fixtures,rehearse,report}.*, Python/TypeScript integration cases, report-template tests and frozen synthetic corpus/questions.

- [x] Define E01session/private-service/CSRF; E02foreign retrieval; E03direct source; E04thread ownership; E05dual-workspace history; E06HR scope; E07forged tool context; E08malicious documents/hostile model; E09invalid citations; E10in-flight revocation; E11history dependency revocation; E12HTML/external-content rendering; E13atomic budgets/limits; E14input/SQL/persistence; E15unscoped positive control.
- [x] Write failing report/admission tests for missing prerequisites, credential/raw-content refusal, duplicate/missing assertions, unsafe HTML and fixture/live conflation.
- [x] Implement the separate unsafe retriever fixture and recording model. The control must expose a foreign synthetic canary; the hardened path must prevent it from entering model context. No paid call is needed for the unsafe control.
- [x] Run deterministic cases against the real application/data boundary, preserve every outcome and assert effects/context rather than only the wording of a model refusal.
- [x] Run a bounded frozen live Gemini set using remaining generation allowance; reserve capacity for a live browser smoke. Record actual model/version, sources, checked citations and known-answer observations. Unavailable or failed calls stay unavailable/failed.
- [x] Export sanitized JSON/Markdown/escaped standalone HTML and SHA256SUMS with exact revision/configuration/corpus/embedding provenance. Preserve failed runs. Commit source after tests.

## M7. Launch, self-review and local release

Files: scripts/cleardesk.mjs and platform wrappers, .github/workflows/verify.yml, README.md, docs/{ARCHITECTURE,THREAT_MODEL,LIMITATIONS,DELIVERY}.md, decisions/, images/, LICENSE/NOTICE and third-party/model attribution.

- [x] Implement project-scoped bootstrap/up/verify/rehearse/stop. Identify owned processes/ports and instance markers; no broad process kills, remote Docker context or modification of another project.
- [x] Expose only the authenticated packaged app as the user-facing entry. Whitelist the Python child environment so it never receives Gemini credentials. Keep all runtime/private data ignored.
- [x] Prepare check-only CI with pinned actions and no mandatory paid provider secret. Do not call prepared CI a remotely observed successful run.
- [x] Perform a focused self-review of all trust boundaries, SQL predicates, revision/dependency handling, budgets, output rendering and report admission. Resolve material findings with failing-then-passing regressions.
- [x] Run the full clean local verification, fresh rehearsal and actual browser checks. Broaden/repeat only for a new fix or unresolved concern.
- [ ] Write a five-minute reviewer walkthrough, actual commands/results, screenshots and explicit limitations. Scan intended source/bundles/evidence for the exact private credential without printing it. Inspect the Git file list and authentic history.
- [ ] Integrate the verified local feature into main, create a local v0.1.0 tag and record evidence/source identity. Public GitHub/portfolio publication remains a follow-up.
- [ ] Mark the goal complete only after the definition of done passes; otherwise report a real remaining provider/environment blocker accurately.

## Self-review of this plan

The plan covers all specified stack components, user journeys and trust boundaries. Each mandatory failure mode maps to a test/evidence milestone. Retrieval quality, citation provenance, deterministic authorization and stochastic live-model behavior have distinct checks. The single-owner DuckDB choice and read-only model scope keep today's target feasible without implying a production multi-writer architecture or universal prompt-injection safety.

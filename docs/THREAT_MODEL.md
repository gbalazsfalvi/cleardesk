# Threat model

## Assets and trust boundaries

The protected assets are workspace/HR document contents, conversation context, source provenance, session/provider credentials and bounded compute capacity. The browser, model output and document text are untrusted. The TypeScript API and Python data owner are trusted application components. Google is an external inference processor, not an authorization service.

The reference uses only fictional organizations and synthetic documents. The local machine owner, operating system and dependency installation environment are trusted. An attacker who can edit private runtime files, read the operator's profile or replace the application can bypass this local application boundary.

## Scenarios and controls

| Threat                                                    | Application control                                                              | Evidence                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Known foreign document/thread identifiers                 | Current session, workspace, owner and document checks inside storage             | E02–E06, real DuckDB tests                       |
| A user legitimately belongs to both workspaces            | Explicit selected-workspace predicates for retrieval, source reads and threads   | E02/E04/E05; delayed-response browser regression |
| Member requests HR knowledge                              | Role predicates before vector ranking; direct reads use the same document policy | E06 and role matrix                              |
| Malicious instructions inside an imported document        | Documents remain data; closed read-tool schemas and server-owned closures        | E07/E08; hostile model fixtures                  |
| Model invents a role, session, workspace or action tool   | Strict schemas, fixed private headers, request/response tool namespace checks    | E07/E08 and provider-transport regressions       |
| Model invents a citation                                  | Per-turn actual-source registry plus storage-side verification                   | E09                                              |
| Permissions change during a model turn                    | Revision checks before every generation dispatch and finalization                | E10; two-step Mastra revocation regression       |
| An answer incorporated uncited restricted context         | All model-visible/inherited dependencies retained; history redaction             | E11 and transitive-dependency tests              |
| Raw HTML, malicious links or tracking images in an answer | Safe Markdown components and restrictive same-origin CSP                         | E12, actual Chromium and renderer fixtures       |
| Cross-site mutation or session fixation                   | HttpOnly/SameSite cookie, exact Origin/Host, synchronizer CSRF, rotation/logout  | E01 and identity/HTTP tests                      |
| Repeated requests, retries or excess concurrency          | Idempotency, counted durable dispatch, actor/global limits, bounded queues       | E13 and cancellation/owner tests                 |
| SQL-like text, unsupported/large documents                | Parameterized SQL, strict UTF-8/filename/size schemas, atomic ingestion          | E14 and ingestion tests                          |
| A broken harness never detects a retrieval leak           | Isolated unscoped-retriever fixture must expose the foreign synthetic canary     | E15                                              |

## What the boundaries establish

A hostile model cannot grant itself authority through the two tools or through the public application body. The data service derives current identity and role independently. Retrieved content is filtered before it is sent to the model. A forged citation cannot become a trusted source link.

These controls do **not** establish that every generated sentence is true, that an accessible document is trustworthy, or that every possible prompt injection is neutralized. A model may misunderstand, fabricate or quote unpleasant material from content it was allowed to see. The renderer prevents executable/network-active output; it does not make the wording appropriate for every audience.

## Revocation and concurrency limits

The workspace revision is intentionally coarse: an unrelated document access change may abort a valid turn. This is a conservative availability tradeoff. Current-access checks cannot recall content already dispatched under valid access. Browser state also discards stale responses after a workspace switch, independently of server authorization.

The API's actor/global admission is per process; DuckDB is owned by one Python process/thread. Running multiple API/data replicas is outside the supported topology. The request ledger counts dispatches across reconstructed instances, but is not a tamper-proof external billing system or a power-loss-resistant distributed ledger.

## Dependency and operational limits

The known upstream dependency finding is recorded in [SECURITY.md](../SECURITY.md). Optional filesystem/workspace/skill features are not configured, and expanding that surface requires a new security review. The application remains loopback-only with synthetic data. Production internet exposure, SSO, TLS/cookie policy, backups, retention, monitoring and organizational approval for external inference are separate work.

## Evidence interpretation

Deterministic model fixtures deliberately exercise unauthorized behavior and observed effects. They are useful for reproducible security assertions but are not Gemini results. The live set uses five fixed English questions and explicit concept/source checks; it is too small for statistical claims. A passing control shows that the tested condition was detected, not that all future attacks are impossible.

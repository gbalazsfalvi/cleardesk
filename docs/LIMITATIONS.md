# Practical limitations

## Product scope

V1 is an English local reference application for a bounded synthetic corpus. Text/Markdown only; no PDF/OCR, remote URLs, cloud-drive connectors, background crawling or arbitrary uploads. The browser imports a file as text; its filename is display metadata, not a server filesystem path.

Document content is immutable per ingestion. Replacing content means adding a new source and retiring the old one. Permissions are WORKSPACE or HR, not arbitrary per-user/per-group grants. Roles are provisioned by the local seed, not a production identity-management interface. There is no password-reset or SSO flow.

## Model and retrieval quality

The offline adapter is a labelled extractive fixture, not a language model. Live mode requires Google and sends permitted context to that provider. No provider-content privacy, retention or compliance policy is inferred from running a local UI.

The 384-dimensional English BGE snapshot is pinned and locally verified. Character-window chunking is simple and reproducible; it is not token-aware, and tokenizer truncation can reduce retrieval quality for long or unusual text. Exact search is suitable for the small active corpus; it is not an ANN scalability benchmark. Similarity alone is not proof that a source answers the question.

The model output gate verifies shape and source provenance. It cannot prove factual entailment, policy correctness or freedom from hallucination. The small fixed live set and regular-expression checks are demonstrations, not a general accuracy estimate or an independent expert assessment.

## Access and history

The revision gate conservatively rejects a turn after any workspace authorization revision change, including unrelated changes. Previously authorized provider traffic cannot be recalled. Saved assistant answers are hidden when any recorded source dependency becomes inaccessible, even if that source was not cited. A user's own question text remains their own visible history.

Soft deletion removes access and retrieval visibility; it is not cryptographic erasure from the database, WAL, backups or previously viewed content. There is no production retention/export/deletion workflow.

## Capacity and persistence

Defaults: 30 active documents and 2,000 chunks per workspace; 64 KiB UTF-8/source; 128 chunks/source; question 2,000 characters; six chunks/read; two model steps; 512 output tokens; 64 KiB provider request; 256 KiB provider response. Threads are capped at 100 per actor/workspace and 50 turns each. There is no conversation deletion. Offline acceptance therefore runs in its own freshly seeded state rather than the owner's demo database, whose accounts can still reach the cap through normal use. Up to v0.1.1 acceptance used the owner's database and eventually failed rehearsal case E12 with `SCENARIO_ERROR` for that reason. Source/chunk/history context limits can reject further work rather than silently dropping security provenance.

One API instance admits one active turn per actor and two overall, with no waiting model queue. Python has a 32-job database queue and a four-slot embedding queue. Cancellation does not instantly stop already-running database/embedding work; admission remains occupied until that actual work completes.

DuckDB has one owning process and one connection thread. There is no supported multi-writer deployment, replicated session store, HA/failover, durable agent workflow resumption or production backup automation. Restart marks interrupted PENDING turns as provider errors instead of pretending to resume them.

The original delivery/evaluation ledger has a 12-attempt cap. Normal application use now has no artificial total quota and uses a separate count-only ledger that carries forward the original attempts. Both count failed/uncertain dispatches and fail closed for invalid state or locks. Local file deletion, operator tampering, filesystem loss and machine compromise are outside this accounting guarantee. There is no production cost reconciliation; Google can impose its own provider/account quotas.

## Operations and dependencies

Local HTTP deliberately uses a non-Secure cookie and loopback bindings. A production deployment requires a reviewed HTTPS/cookie/origin configuration and an appropriate identity/operations design. The Python child receives a whitelisted environment without provider credentials; private files on Windows inherit the operator profile's filesystem ACLs.

The withdrawn npm advisory history and the disabled optional features are documented in [SECURITY.md](../SECURITY.md). Dependency pins make the evidence reproducible; they are not a promise that all transitive packages or future releases are vulnerability-free. The current Python TestClient emits one upstream httpx deprecation warning; the tested compatibility path still passes.

## Release evidence

Screenshots are actual local captures. Fixture screenshots remain explicitly labelled. The source is published on GitHub; GitHub Actions runs `npm run verify` on Ubuntu but does not start the application, run browsers or call a model. The application lifecycle, browser journeys and HTTP review were observed on Windows only. There is no public running deployment of the application. Source revisions/tree hashes and working-tree state are retained so observations from different implementation stages are not conflated.

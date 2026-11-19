# Local operations

## Start, stop and mode changes

Run commands from the project root. `npm run bootstrap` installs the pinned dependencies, prepares the embedding cache, provisions generated synthetic accounts and builds the app. Stop an existing ClearDesk instance before bootstrapping again. It does not require Docker, a database server or a provider key for fixture mode.

`npm run demo` performs setup/build/start in one command. `npm run validate:demo` performs full offline acceptance in an isolated synthetic state (`.local/acceptance/<run>`, selected through `CLEARDESK_STATE`) and creates fresh retrieval/security reports plus browser observations. The owner's demo database, credentials and mode are untouched; a running owner instance is stopped for the run and restarted in its previous mode. It makes no provider generation request.

`npm run up` starts the authenticated app on `127.0.0.1:4280` and the private data adapter on `127.0.0.1:4281`. Only the app is a browser entry point. `npm run stop` verifies the recorded process command lines before stopping them, waits for the sockets to drain and refuses to interfere with an unrecognized replacement process. Occupied ports are errors, not a reason to kill another project's processes.

```sh
node scripts/cleardesk.mjs mode fixture
node scripts/cleardesk.mjs mode live
```

Mode changes restart the owned instance. Fresh installs default to fixture. Live mode requires a real ignored `.env.local`; a missing credential is an explicit startup failure. No browser variable or Python environment setting contains that credential.

The optional Vite development server uses port 4282 and proxies `/api` to the app. It is not necessary to review the packaged application. The tested runtime versions and observed commands are in [DELIVERY.md](DELIVERY.md).

## Private state

| Path                                    | Purpose                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `.env.local`                            | Google credential, read by TypeScript only                        |
| `.local/private/runtime.json`           | Local instance identifier, private service credential and mode    |
| `.local/private/processes.json`         | Owned process IDs and project marker                              |
| `.local/private/demo-accounts.json`     | Generated demo passwords and seed IDs/checkpoint                  |
| `.local/private/generation-budget.json` | Original bounded delivery/evaluation ledger; preserved on upgrade |
| `.local/private/application-usage.json` | Count-only application dispatch history; no total request quota   |
| `.local/data/cleardesk.duckdb`          | Identity, source text/vectors, threads, dependencies and activity |
| `.local/models/`                        | Pinned embedding artifacts and actual hash manifest               |
| `.local/delivery/`                      | Private execution/check logs                                      |
| `artifacts/runs/`                       | Every generated evidence run, including failures/incomplete runs  |

These are ignored by Git. Unix writes request private file modes; Windows uses the inherited operator-profile ACLs. Do not treat `.gitignore` as encryption or a substitute for host access control. Source scans compare the actual available provider/service/demo secrets without printing their values or fingerprints.

## Budget behavior

Every admitted generation HTTP request reserves one attempt before network dispatch. Framework/tool steps and retries use the same counted transport. A network error or cancelled uncertain request remains spent. Invalid state and a leftover lock fail closed. Responses are not replaced with a fixture answer when a live call fails.

The original delivery/evaluation ledger has a cap of 12 attempts. Normal application traffic now uses a separate count-only ledger with `limit: null`, following the owner's explicit request to remove the artificial chat quota. Its first initialization copies every original attempt, retaining identifiers/timestamps; the original ledger remains byte-for-byte unchanged. Existing application state is never silently reset. Read [LIVE_CHAT_REPAIR.md](LIVE_CHAT_REPAIR.md) for the correction. These ledgers are neither external billing records nor resilient to malicious local operators deleting files.

For a stale lock, first stop and verify all owned ClearDesk/evaluation processes. Preserve the ledger and evidence before operator inspection; do not delete it merely to obtain a passing check. Any later, deliberately new operator-led allowance must archive the previous ledger and record why it changed. **Do not reset the delivery allowance during automated verification.** A real production product needs durable daily quotas, access-controlled administration and cost reconciliation.

## Recovery and data lifecycle

Bootstrap writes generated passwords before creating their database accounts. An interrupted first run resumes with the same passwords and deduplicates already committed seed documents. A completed credentials manifest paired with a missing database fails clearly instead of pretending to initialize successfully.

Keep database and credentials metadata together in any private backup. Stop the owner before making a simple file backup; no automated backup/restore service is included. Do not remove a locked database to make startup pass. Restore a consistent pair or deliberately provision a separate new instance after reviewing the existing state.

Committed migration bytes are checksum-checked. Add a migration rather than editing one. Restart marks interrupted PENDING turns as provider errors; it does not fabricate a resumed model completion. Soft-deleted sources remain in storage but disappear from accessible retrieval/source reads.

## Evidence workflow

1. Use fixture mode and run `npm run verify`.
2. Run `npm run evaluate:retrieval` against the verified local model cache.
3. Run `npm run rehearse` against the active synthetic data service and run the normal browser suite.
4. Only when needed, use an explicit live command. The frozen evaluator obeys its original bounded ledger; the application browser smoke has at most two model steps and records its actual count-only usage delta.
5. Export the latest run of each evidence kind and verify its hashes. Keep previous runs; a newer failure must not be silently replaced with an older success.

Fixture, actual local-vector, live Gemini and browser observations answer different questions. Reports retain source identity/working-tree state. A report from an earlier implementation stage is not labelled as a final-source rerun.

New reports declare source hash method `utf8-lf-v1`: declared UTF-8 source text is hashed with LF line endings, so Git's Windows checkout conversion does not change its identity. Paths and binary bytes remain significant. Older reports without this field used raw source bytes and retain their original observations. Report and screenshot SHA-256 inventories always verify exact artifact bytes; source newline normalization does not apply to those inventories.

## Production is separate work

Before internet exposure, review identity/SSO, HTTPS/Secure cookies and trusted origins, external-inference data policy, monitoring, dependency findings, backups/retention, multi-instance admission and a supported data deployment. These features are outside this local reference release. See [LIMITATIONS.md](LIMITATIONS.md) and [SECURITY.md](../SECURITY.md).

# ClearDesk v1 delivery goal

**Target:** 18 November 2026, 23:59 Europe/Budapest (22:59 UTC).
**Deliverable:** a complete local, GitHub-ready internal knowledge assistant with a polished English interface and inspectable security evidence.
**Current status:** verified local v0.1.0 reference completed; public publication remains separate.

The deadline is a target. Completion is determined by actual acceptance checks, never by weakening controls or inventing results.

## Definition of done

- [x] One command bootstraps/builds/starts the owned local application and data service; another verifies it and generates a fresh security report.
- [x] Users can authenticate, select an authorized workspace, ask grounded questions, open authorized sources and revisit their own appropriately redacted history.
- [x] Administrators can ingest bounded text/Markdown documents, set workspace/HR visibility and revoke access by ACL changes or deletion.
- [x] Mastra is used in the real Gemini path; the authorized credential remains private and server-side. Agent-run live generation requests stay within the cap of 12.
- [x] DuckDB has one Python owner, serialized transactions and bounded retrieval/embedding work. Node never opens the database file.
- [x] Tenant, document, conversation and tool boundaries hold under deterministic adversarial-model tests. A separate unscoped-retrieval positive control demonstrates that the test detects context exposure.
- [x] Current access is checked at retrieval/source/history access and before storing/returning an answer. Citation identifiers belong to the actual authorized context registry.
- [x] Output cannot execute raw HTML or trigger automatic external content loads; requests, queue depth, tool steps and provider usage are bounded.
- [x] Meaningful TypeScript/Python/database/API/browser checks pass. A bounded live Gemini evaluation records actual model/provider identifiers and outcomes separately from fixtures.
- [x] Sanitized JSON, Markdown and standalone HTML reports, SHA-256 inventories and actual desktop/mobile screenshots are available.
- [x] README, API, architecture, threat model, decisions, limitations, licences/notices, pinned dependencies and a prepared CI workflow match the implementation.
- [x] Final clean local verification/rehearsal passes and the local source history/release state matches the reported evidence.

Today's scope is a local reference. Public GitHub/portfolio publication, arbitrary document formats, enterprise SSO, external actions and distributed/multi-writer deployment are follow-ups.

## Allocation targets

| Local time, Europe/Budapest | Deliverable                                                            |
| --------------------------- | ---------------------------------------------------------------------- |
| 11:45–12:30                 | Design/contracts, locked foundation and provider integration preflight |
| 12:30–14:30                 | Identity, DuckDB store, scope/ACL policy and permission-aware history  |
| 14:30–16:00                 | Ingestion, local embeddings, retrieval and Mastra/Gemini answer flow   |
| 16:00–18:00                 | Responsive chat, sources, workspace and admin interface                |
| 18:00–20:00                 | Adversarial cases, live evaluations and evidence reports               |
| 20:00–22:00                 | Integrated browser/restart checks, documentation and local release     |
| 22:00–23:59                 | Integration/debugging buffer                                           |

These windows are plans, not recorded completion times.

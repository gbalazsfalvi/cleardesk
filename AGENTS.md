# ClearDesk operating rules

ClearDesk is an independent local reference product. All code, comments, UI, documentation and reports are English.

- Work only in this project. Do not modify Slotkeeper, sibling repositories, existing processes, Docker workloads, live sites or private employer code.
- Stack: TypeScript/Mastra backend, React/Vite frontend, Python/FastAPI data service, DuckDB with one owner process. No Node process opens the DuckDB file.
- Authentication, workspace/document authorization and citation provenance are server decisions. Model prompts and model-supplied identifiers never grant authority.
- Internal service requests require the private service credential and a real session. Re-derive membership in the data service; do not trust model/browser actor, role or workspace claims.
- Keep Mastra memory, public agent endpoints and raw-content tracing disabled. Supply authorized conversation context explicitly per turn. Tools are narrowly scoped closures with strict schemas.
- Provider credentials are read only from ignored local configuration on the TypeScript server. Never put them in VITE variables, browser bundles, URLs, command-line arguments, logs, evidence, source or commits. Never send Gemini credentials to the Python service or embedding hosts.
- Live automated verification is capped at 12 generation HTTP requests, including automatic retries and framework subcalls. Use synthetic documents, bounded inputs/outputs and the configured official Google endpoint only.
- Use meaningful failing tests before behavioral implementation. Deterministic hostile-model and unscoped-retriever fixtures are labelled controls, not live model results. Do not reuse the production authorization function as the test oracle.
- No arbitrary SQL, URL fetching, shell, filesystem or external-message tool. No unsafe product switch. Teaching controls remain test-only.
- Keep Mastra workspace/filesystem/skill features disabled. The current unpatched optional-globbing advisory and its scope restrictions are recorded in SECURITY.md; do not expand that surface without a new review.
- No raw HTML or automatic external-image loading from model output. All source links recheck current access.
- Preserve incomplete/failed runs. Missing assertions, provider failures and fixture results are not PASS or Gemini evidence.
- Pin dependencies, keep an authentic local Git history and document actual versions/results. This goal delivers a local GitHub-ready release; it does not publish remotely.
- No selected-environment skills are currently available; use the supplied design, plan, tests and a recorded self-review.

Read GOAL.md, docs/DESIGN.md, docs/API.md and docs/plans/2026-11-18-cleardesk-v1.md. Record progress under .local/delivery/ and observed release checks in docs/DELIVERY.md.

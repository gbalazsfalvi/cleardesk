# Changelog

All notable changes to ClearDesk. Dates use Europe/Budapest.

## v0.1.1 — 19 November 2026

First public release. It contains all changes made after the local v0.1.0 tag.

### Fixed

- Normal chat no longer shares the bounded twelve-request evaluation allowance. A dedicated count-only ledger carries forward earlier attempts; the original evaluation ledger is unchanged. An exhausted bounded evaluation now stores `BUDGET_EXHAUSTED` instead of a misleading provider error. ([record](docs/LIVE_CHAT_REPAIR.md))
- The 16 KiB chat request limit now applies to chunked transfers as well as declared lengths. ([record](docs/LOCAL_SECURITY_REVIEW.md))
- Missing, blank or overlong CSRF headers are rejected with `403 CSRF_REJECTED` before the private service is contacted.
- The composer and knowledge library use singular counts (“1 accessible source”). On narrow screens the workspace label no longer runs into the count.
- Browser journeys no longer overwrite hash-bound images in `docs/images`. Screenshots stay in the ignored run directory until a reviewed copy is promoted.

### Added

- Prompt-injection assessment with six deterministic and six live Gemini scenarios. ([record](docs/PROMPT_INJECTION_ASSESSMENT.md))
- Repeatable loopback HTTP adversarial review: `npm run assess:http`.
- v0.1.1 verification snapshots. ([record](docs/verification/v0.1.1/README.md))

### Security

- The `picomatch` advisory disclosed in v0.1.0 was withdrawn upstream on 18 November 2026. The installed version is unchanged; see [SECURITY.md](SECURITY.md).

## v0.1.0 — 18 November 2026

Local reference release with sessions, workspace and HR roles, local semantic retrieval, source-validated answers, permission-aware history, a deterministic security rehearsal and a bounded live Gemini evaluation. It was tagged locally and not published remotely at the time. ([delivery record](docs/DELIVERY.md))

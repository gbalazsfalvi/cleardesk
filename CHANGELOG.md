# Changelog

All notable changes to ClearDesk. Dates use Europe/Budapest.

## Unreleased

### Fixed

- `npm run validate:demo` no longer uses the owner's demo database. Each run seeds a fresh synthetic state in `.local/acceptance/<run>` (selected through the strictly validated `CLEARDESK_STATE`), so repeated runs cannot exhaust the 100-conversation cap and the owner's instance keeps its mode. The secret scan also covers acceptance states. ([record](docs/verification/isolated-acceptance/README.md))

## v0.1.1 — 19 November 2026

First public release. It contains all changes made after the local v0.1.0 tag.

### Fixed

- Normal chat no longer shares the bounded twelve-request evaluation allowance. A dedicated count-only ledger carries forward earlier attempts; the original evaluation ledger is unchanged. An exhausted bounded evaluation now stores `BUDGET_EXHAUSTED` instead of a misleading provider error. ([record](docs/LIVE_CHAT_REPAIR.md))
- The 16 KiB chat request limit now applies to chunked transfers as well as declared lengths. ([record](docs/LOCAL_SECURITY_REVIEW.md))
- Missing, blank or overlong CSRF headers are rejected with `403 CSRF_REJECTED` before the private service is contacted.
- The composer and knowledge library use singular counts (“1 accessible source”). On narrow screens the workspace label no longer runs into the count.
- Browser journeys no longer overwrite hash-bound images in `docs/images`. Screenshots stay in the ignored run directory until a reviewed copy is promoted.
- `npm run verify` now succeeds on a fresh clone: type checking builds the shared contracts package first instead of relying on a previously built `dist/`.
- `npm run assess:http` works on a fresh install that has not made a live request yet. A missing generation ledger is observed as zero attempts and compared before and after, instead of crashing.
- The GitHub Actions workflow runs on `ubuntu-24.04`, which provides the verified Python 3.13.1; `ubuntu-latest` (26.04) does not.

### Added

- Prompt-injection assessment with six deterministic and six live Gemini scenarios. ([record](docs/PROMPT_INJECTION_ASSESSMENT.md))
- Repeatable loopback HTTP adversarial review: `npm run assess:http`.
- v0.1.1 verification snapshots. ([record](docs/verification/v0.1.1/README.md))

### Security

- The `picomatch` advisory disclosed in v0.1.0 was withdrawn upstream on 18 November 2026. The installed version is unchanged; see [SECURITY.md](SECURITY.md).

## v0.1.0 — 18 November 2026

Local reference release with sessions, workspace and HR roles, local semantic retrieval, source-validated answers, permission-aware history, a deterministic security rehearsal and a bounded live Gemini evaluation. It was tagged locally and not published remotely at the time. ([delivery record](docs/DELIVERY.md))

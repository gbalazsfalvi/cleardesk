# Live chat quota correction

18 November 2026, after the local v0.1.0 delivery.

## Observed cause

The application incorrectly shared the delivery evaluation's persistent twelve-request allowance. Nine delivery verification dispatches and three later user dispatches exhausted it. Subsequent requests failed before contacting Google. The immediate API error identified `BUDGET_EXHAUSTED`, but stored conversation history flattened this to `PROVIDER_ERROR`, incorrectly suggesting a temporary upstream outage.

The owner explicitly requested that normal chat usage have no artificial request quota. This is a product correction, not a reset intended to make an old evaluation pass.

## Correction

- Normal application use has no artificial total quota. Its count-only ledger is `.local/private/application-usage.json`, with an explicit null limit.
- Initial migration copies all previous attempt identifiers and timestamps; `.local/private/generation-budget.json` remains unchanged and bounded. Existing usage state is never silently reinitialized.
- Bounded evaluation use remains available through the explicit `ProviderBudget` numeric constructor. The frozen evaluator still uses its original delivery ledger.
- Exhausted bounded evaluations keep a distinct persisted `BUDGET_EXHAUSTED` status and explanatory history text.
- Origin/session/CSRF checks, document permissions, citation validation, per-turn size/step/time limits and concurrency protections continue to apply. There is no fallback response presented as Gemini output.

## Verification

Regression tests reproduce the original thirteenth-request failure and misleading stored status before the fix. They check successful dispatch accounting beyond twelve, restart persistence, byte-preserved legacy history, bounded-counter rejection, and the specific stored allowance outcome.

Final full-suite and live-browser results are recorded after verification. The browser check uses Jordan, explicitly selects Northstar Studio, asks about travel expenses, and opens the currently authorized source. Earlier v0.1.0 evidence remains historical and is not relabelled as a run of this correction.

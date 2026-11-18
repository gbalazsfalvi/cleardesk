# Reviewed evidence snapshots

These files are generated from actual local runs. The complete run history stays under ignored `artifacts/runs/`. Export chooses the **latest** run of each required kind, including a failure/incomplete result; it does not search backwards for a passing run.

| Evidence | What it establishes |
|---|---|
| [Deterministic security rehearsal](security/report.md) · [HTML](security/report.html) | Fifteen reproducible adversarial/recording-fixture cases across application/data boundaries |
| [Actual local-vector retrieval](retrieval/report.md) · [HTML](retrieval/report.html) | Five fixed known-answer top-1 checks and one scope control using pinned ONNX vectors and production DuckDB search |
| [Live Gemini evaluation](live/report.md) · [HTML](live/report.html) | Five frozen synthetic questions, actual provider metadata and explicit concept/source checks |
| [Live browser observation](browser-live/report.json) | One actual Gemini answer, a currently authorized opened source, observed request usage and a screenshot hash |

The evidence kinds are intentionally separate. A deterministic fixture is not a Gemini completion; a citation is provenance, not a proof of truth; five questions are not a statistical benchmark. Read each report's limitations and [DELIVERY.md](../DELIVERY.md) for the sequence of source changes.

Reports retain actual source identifiers/hashes and working-tree state. Earlier observations are not relabelled as final-source reruns. Browser/source screenshots in [../images](../images/) are actual captures; fixture images include `fixture` in the filename and mode badge.

```sh
npm run evidence:export
npm run evidence:verify
```

`index.json` binds the selected runs and screenshots. The aggregate `SHA256SUMS` and each report's own `SHA256SUMS` detect changed bytes. Generated evidence is excluded from formatting tools because reformatting it would invalidate those hashes. Regenerate/review evidence instead of hand-editing a result.

Private credentials, raw document content, raw provider error bodies and arbitrary unreviewed prompts are excluded from report writers. The public questions are fixed synthetic fixtures. Actual available private secrets are compared against staged source, built browser assets and exported evidence before release, without printing their values.

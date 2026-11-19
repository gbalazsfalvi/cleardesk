# ClearDesk security rehearsal

2026-11-19T07:47:40.259Z · **PASS** · 15/15 cases passed

Mode: deterministic adversarial and recording fixtures. This is not live Gemini evidence.

| Case | Boundary | Result |
|---|---|---|
| E01 | Session and private-service boundary | PASS |
| E02 | Retrieval before model context | PASS |
| E03 | Direct source and chunk access | PASS |
| E04 | Conversation ownership | PASS |
| E05 | Dual-workspace conversation context | PASS |
| E06 | People-team document permissions | PASS |
| E07 | Forged authority arguments | PASS |
| E08 | Prompt-injection authority containment | PASS |
| E09 | Citation provenance gate | PASS |
| E10 | In-flight permission change | PASS |
| E11 | Uncited context revocation | PASS |
| E12 | Adversarial text in the production renderer | PASS |
| E13 | Durable budget and bounded admission | PASS |
| E14 | Inputs, literal SQL values and persistence | PASS |
| E15 | Unscoped retriever positive control | PASS |

## Provenance

```json
{
  "sourceRevision": "76e66fc693b6a476975defc216cf24c6623ddcb6",
  "sourceTreeSha256": "2b9cc0173fb195610ddfb2dc30107a149d722c2b29e0cb6abee8e35a516ded76",
  "sourceTreeHashMethod": "utf8-lf-v1",
  "workingTreeDirty": false,
  "corpusSha256": "4e52bffcfff2f9cd945f9c05b5d7bb5444212e8f26b47bdf17aff543224a9af8",
  "embeddingManifestSha256": "7abeb180b9c205b60f1094e7deba05e39e36a92b7a7356c6fd4b412552757cb7",
  "node": "24.14.0",
  "python": "3.13.1",
  "mastra": "1.84.0",
  "googleAdapter": "4.0.122"
}
```

## Limits

- Deterministic scenarios use adversarial/recording model fixtures, not Gemini completions.
- The API is exercised in-process through Hono and across actual HTTP to the private DuckDB service; browser renderer checks use Chromium.
- The unsafe retriever is an isolated synthetic test control, never a product configuration.
- A valid citation proves source provenance, not semantic correctness or universal prompt-injection resistance.
- Provider content already dispatched under valid access cannot be recalled after revocation.

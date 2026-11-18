# ClearDesk local retrieval evaluation

PASS · 2026-11-18T13:03:04.017374+00:00

| Case | Kind | Result | Top source |
|---|---|---|---|
| R01 | known-answer | PASS | handbook |
| R02 | known-answer | PASS | expenses |
| R03 | known-answer | PASS | security |
| R04 | known-answer | PASS | hr |
| R05 | scope-control | PASS | hostile |
| R06 | known-answer | PASS | harbor-guide |

- Five fixed English known-answer questions and one scope control, not a statistical retrieval benchmark.
- Uses actual local ONNX vectors and production DuckDB retrieval code in a separate owned temporary database.
- No Gemini result, model answer or semantic-accuracy claim is implied.

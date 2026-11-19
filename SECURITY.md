# Security

ClearDesk is a local reference application with synthetic data. Its evidence demonstrates specific application boundaries, not a universal security certification. Read [the threat model](docs/THREAT_MODEL.md), [limitations](docs/LIMITATIONS.md) and [delivery evidence](docs/DELIVERY.md) before reusing it.

## Dependency advisory history

**Current state (19 November 2026).** `npm audit --omit=dev` and the full `npm audit` both report zero findings for the committed lockfile. The installed `picomatch` version is still **4.0.7**; no dependency was upgraded. The audit result changed because GitHub **withdrew** the advisory below on 18 November 2026 at 15:38 UTC. The advisory database still lists no patched version.

**Historical record (18 November 2026).** The v0.1.0 audit reported **GHSA-fc5q-39xc-vjpf / CVE-2026-112366** (ReDoS through single-branch repeated extglobs, rated high) in `picomatch` 4.0.7, attributed transitively to Mastra. The [advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) listed no patched release, so v0.1.0 disclosed it instead of reporting it as fixed.

The withdrawal is recorded as the upstream advisory's current status, not as a code fix or as proof that the package is safe. The scope restriction from v0.1.0 remains in force: the installed Mastra call site is its optional workspace glob matcher, and ClearDesk configures no workspace/filesystem tools or skills. Provider request/response gates permit only `searchKnowledge` and `readSource`; document filenames are literal DuckDB metadata. These restrictions are tested. Enabling glob/workspace features still requires a separate review.

Dependency pins make the evidence reproducible; they are not a promise that current or future transitive packages are vulnerability-free.

## Reporting an issue

For a sensitive finding, contact `balazsfalvi12@gmail.com` with a minimal synthetic reproduction, affected revision and expected/observed behavior. Do not include real company documents, API keys, passwords or session cookies. A [public issue](https://github.com/gbalazsfalvi/cleardesk/issues) is suitable for non-sensitive defects.

No production support window, response-time SLA or bug bounty is promised.

import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Fixed assertions prevent a case with no observations from becoming a green result. */
export const CASES = [
  {
    id: 'E01',
    title: 'Session and private-service boundary',
    checks: [
      'private_credential_required',
      'anonymous_denied',
      'csrf_and_origin_checked',
      'session_rotated_logout_invalid',
    ],
  },
  {
    id: 'E02',
    title: 'Retrieval before model context',
    checks: ['selected_workspace_only', 'filter_before_model', 'dual_workspace_user_covered'],
  },
  {
    id: 'E03',
    title: 'Direct source and chunk access',
    checks: ['foreign_source_denied', 'foreign_chunk_denied', 'own_source_readable'],
  },
  {
    id: 'E04',
    title: 'Conversation ownership',
    checks: ['foreign_owner_denied', 'foreign_workspace_thread_denied', 'own_thread_readable'],
  },
  {
    id: 'E05',
    title: 'Dual-workspace conversation context',
    checks: ['history_selected_workspace_only', 'context_selected_workspace_only'],
  },
  {
    id: 'E06',
    title: 'People-team document permissions',
    checks: ['member_hr_denied', 'hr_source_readable', 'hr_not_admin'],
  },
  {
    id: 'E07',
    title: 'Forged authority arguments',
    checks: [
      'forged_tool_authority_rejected',
      'forged_public_role_rejected',
      'scoped_tool_still_works',
    ],
  },
  {
    id: 'E08',
    title: 'Prompt-injection authority containment',
    checks: [
      'injection_does_not_grant_foreign_read',
      'no_action_tool',
      'foreign_content_absent_from_context',
    ],
  },
  {
    id: 'E09',
    title: 'Citation provenance gate',
    checks: ['fabricated_citation_rejected', 'unverified_text_not_saved'],
  },
  {
    id: 'E10',
    title: 'In-flight permission change',
    checks: ['revision_conflict_returned', 'answer_discarded', 'stale_text_not_saved'],
  },
  {
    id: 'E11',
    title: 'Uncited context revocation',
    checks: ['uncited_dependency_revoked', 'history_redacted', 'subsequent_context_clean'],
  },
  {
    id: 'E12',
    title: 'Adversarial text in the production renderer',
    checks: [
      'no_executable_html',
      'no_external_image_request',
      'no_arbitrary_link',
      'useful_markdown_preserved',
    ],
  },
  {
    id: 'E13',
    title: 'Durable budget and bounded admission',
    checks: [
      'failed_attempts_stay_spent',
      'restart_preserves_cap',
      'excess_dispatch_refused',
      'actor_and_global_caps',
    ],
  },
  {
    id: 'E14',
    title: 'Inputs, literal SQL values and persistence',
    checks: [
      'sql_title_is_literal',
      'ingest_bounds_checked',
      'source_hash_matches',
      'independent_session_reads_same_source',
    ],
  },
  {
    id: 'E15',
    title: 'Unscoped retriever positive control',
    checks: ['unsafe_canary_observed', 'hardened_canary_absent', 'fixture_label_explicit'],
  },
] as const;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^[a-zA-Z0-9_.+-]{1,80}$/);
export const provenanceSchema = z
  .object({
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    sourceTreeSha256: hash,
    workingTreeDirty: z.boolean(),
    corpusSha256: hash,
    embeddingManifestSha256: hash,
    node: version,
    python: version,
    mastra: version,
    googleAdapter: version,
  })
  .strict();
const recordSchema = z
  .object({
    id: z.string().regex(/^E\d{2}$/),
    assertions: z.record(z.string(), z.boolean()),
    errorCode: z.enum(['SCENARIO_ERROR', 'PREREQUISITE_UNAVAILABLE']).optional(),
  })
  .strict();
const inputSchema = z
  .object({
    provenance: provenanceSchema,
    prerequisites: z
      .object({
        dataReady: z.boolean(),
        syntheticCorpus: z.boolean(),
        fixtureOnly: z.boolean(),
        browserAvailable: z.boolean(),
      })
      .strict(),
    records: z.array(recordSchema).max(15),
  })
  .strict();
export type CaseRecord = z.infer<typeof recordSchema>;
type Status = 'PASS' | 'FAIL' | 'ERROR' | 'INCOMPLETE';

/** Only allowlisted metadata and Boolean observations enter a public security report. */
export function buildReport(input: unknown) {
  const parsed = inputSchema.parse(input);
  if (new Set(parsed.records.map((item) => item.id)).size !== parsed.records.length)
    throw new Error('DUPLICATE_CASE');
  for (const record of parsed.records) {
    const definition = CASES.find((item) => item.id === record.id);
    if (
      !definition ||
      Object.keys(record.assertions).some(
        (key) => !(definition.checks as readonly string[]).includes(key),
      )
    )
      throw new Error('UNKNOWN_ASSERTION');
  }
  const cases = CASES.map((definition) => {
    const record = parsed.records.find((item) => item.id === definition.id);
    let status: Status = 'INCOMPLETE';
    if (record?.errorCode) status = 'ERROR';
    else if (record && definition.checks.every((key) => Object.hasOwn(record.assertions, key)))
      status = definition.checks.every((key) => record.assertions[key]) ? 'PASS' : 'FAIL';
    return {
      ...definition,
      status,
      assertions: record?.assertions ?? {},
      errorCode: record?.errorCode ?? null,
    };
  });
  const status: Status = !Object.values(parsed.prerequisites).every(Boolean)
    ? 'INCOMPLETE'
    : cases.some((item) => item.status === 'ERROR')
      ? 'ERROR'
      : cases.some((item) => item.status === 'FAIL')
        ? 'FAIL'
        : cases.some((item) => item.status === 'INCOMPLETE')
          ? 'INCOMPLETE'
          : 'PASS';
  return {
    schemaVersion: 1,
    product: 'ClearDesk',
    edition: '0.1.0',
    kind: 'deterministic-fixture',
    generatedAt: new Date().toISOString(),
    status,
    provenance: parsed.provenance,
    prerequisites: parsed.prerequisites,
    cases,
    limitations: [
      'Deterministic scenarios use adversarial/recording model fixtures, not Gemini completions.',
      'The API is exercised in-process through Hono and across actual HTTP to the private DuckDB service; browser renderer checks use Chromium.',
      'The unsafe retriever is an isolated synthetic test control, never a product configuration.',
      'A valid citation proves source provenance, not semantic correctness or universal prompt-injection resistance.',
      'Provider content already dispatched under valid access cannot be recalled after revocation.',
    ],
  };
}
export type EvidenceReport = ReturnType<typeof buildReport>;
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function provenance(root: string) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(
      (name) =>
        /^(apps|packages|services|scripts|verification)\//.test(name) ||
        /^[^/]+\.(json|ts)$/.test(name),
    );
  const tree = createHash('sha256');
  for (const name of [...new Set(files)].sort()) {
    tree.update(name.replaceAll('\\', '/') + '\0');
    tree.update(readFileSync(join(root, name)));
    tree.update('\0');
  }
  const sha = (relative: string) =>
    createHash('sha256')
      .update(readFileSync(join(root, relative)))
      .digest('hex');
  return {
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceTreeSha256: tree.digest('hex'),
    workingTreeDirty:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
        .length > 0,
    corpusSha256: sha('verification/corpus.json'),
    embeddingManifestSha256: sha('.local/models/embedding-model.json'),
    node: process.versions.node,
    python: execFileSync(
      join(
        root,
        'services/knowledge/.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
      ['--version'],
      {
        encoding: 'utf8',
        env: {
          SystemRoot: process.env.SystemRoot ?? '',
          PATH: process.env.PATH ?? '',
          PYTHONUTF8: '1',
        },
      },
    )
      .trim()
      .replace(/^Python /, ''),
    mastra: JSON.parse(readFileSync(join(root, 'node_modules/@mastra/core/package.json'), 'utf8'))
      .version as string,
    googleAdapter: JSON.parse(
      readFileSync(join(root, 'node_modules/@ai-sdk/google/package.json'), 'utf8'),
    ).version as string,
  };
}

/** Preserve every run; JSON, Markdown and self-contained HTML share the same admitted observations. */
export function writeEvidence(root: string, report: EvidenceReport) {
  const runId = report.generatedAt.replaceAll(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const directory = join(root, 'artifacts/runs/security', runId);
  mkdirSync(directory, { recursive: true });
  const passed = report.cases.filter((item) => item.status === 'PASS').length;
  const markdown = `# ClearDesk security rehearsal\n\n${report.generatedAt} · **${report.status}** · ${passed}/${report.cases.length} cases passed\n\nMode: deterministic adversarial and recording fixtures. This is not live Gemini evidence.\n\n| Case | Boundary | Result |\n|---|---|---|\n${report.cases.map((item) => `| ${item.id} | ${item.title} | ${item.status} |`).join('\n')}\n\n## Provenance\n\n\`\`\`json\n${JSON.stringify(report.provenance, null, 2)}\n\`\`\`\n\n## Limits\n\n${report.limitations.map((item) => '- ' + item).join('\n')}\n`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'"><title>ClearDesk · Security evidence</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#243e37;background:#f6f8f1;margin:0}main{max-width:1050px;margin:auto;padding:55px 28px}small{letter-spacing:2px;color:#637c50}h1{font-size:48px;letter-spacing:-2px;line-height:1.15;font-weight:500}p{color:#617456}.summary{padding:22px;border:1px solid #cddcc1;border-radius:8px;background:#eaf1df}table{border-collapse:collapse;width:100%;margin:30px 0}td,th{text-align:left;padding:13px;border-bottom:1px solid #dce5d4;font-size:13px}th{color:#7d926b}.status{font-weight:600}pre{white-space:pre-wrap;word-break:break-all;background:white;padding:20px;border:1px solid #dde7d4;border-radius:7px;font-size:12px}li{margin:10px 0;font-size:13px}footer{color:#879977;font-size:11px;margin-top:45px}</style><main><small>CLEARDESK / REFERENCE EVIDENCE</small><h1>Helpful. With tested boundaries.</h1><p>Deterministic adversarial and recording fixtures · ${escapeHtml(report.generatedAt)}</p><div class="summary"><strong>${report.status}</strong> · ${passed}/${report.cases.length} cases passed. No live model result is implied by this report.</div><table><thead><tr><th>Case</th><th>Boundary under test</th><th>Observed result</th></tr></thead><tbody>${report.cases.map((item) => `<tr><td>${item.id}</td><td>${escapeHtml(item.title)}</td><td class="status">${item.status}</td></tr>`).join('')}</tbody></table><h2>What this does and does not establish</h2><ul>${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><h2>Reproduction identity</h2><pre>${escapeHtml(JSON.stringify(report.provenance, null, 2))}</pre><h2>Complete observations</h2><pre>${escapeHtml(JSON.stringify(report.cases, null, 2))}</pre><footer>ClearDesk 0.1.0 · Synthetic organizations only · Local verification</footer></main></html>`;
  const outputs = {
    'report.json': JSON.stringify(report, null, 2) + '\n',
    'report.md': markdown,
    'report.html': html,
  };
  for (const [name, content] of Object.entries(outputs))
    writeFileSync(join(directory, name), content);
  writeFileSync(
    join(directory, 'SHA256SUMS'),
    Object.entries(outputs)
      .map(([name, content]) => createHash('sha256').update(content).digest('hex') + '  ' + name)
      .join('\n') + '\n',
  );
  return { directory, runId, status: report.status };
}

/** Export the latest observed run of each kind; never cherry-pick an older passing run. */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'docs/evidence');
const kinds = [
  { directory: 'security', kind: 'deterministic-fixture' },
  { directory: 'retrieval', kind: 'actual-local-embedding-retrieval' },
  { directory: 'live', kind: 'live-gemini' },
  { directory: 'browser-live', kind: 'live-gemini-browser' },
];
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function manifest(directory) {
  const entries = readFileSync(join(directory, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$/.exec(line);
      if (!match || match[2].split('/').includes('..') || match[2].startsWith('/'))
        throw new Error('EVIDENCE_MANIFEST_INVALID');
      const path = resolve(directory, match[2]);
      if (!path.startsWith(resolve(directory) + '/') && !path.startsWith(resolve(directory) + '\\'))
        throw new Error('EVIDENCE_PATH_INVALID');
      if (hash(path) !== match[1]) throw new Error('EVIDENCE_HASH_MISMATCH');
      return { name: match[2], sha256: match[1] };
    });
  if (!entries.length || new Set(entries.map((item) => item.name)).size !== entries.length)
    throw new Error('EVIDENCE_MANIFEST_INVALID');
  return entries;
}
function verify() {
  const entries = manifest(output);
  const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8'));
  if (index.artifacts.length !== kinds.length) throw new Error('EVIDENCE_INCOMPLETE');
  for (const definition of kinds) {
    const record = index.artifacts.find(
      (item) => item.kind === definition.kind && item.directory === definition.directory,
    );
    if (!record || hash(join(output, definition.directory, 'report.json')) !== record.reportSha256)
      throw new Error('EVIDENCE_INDEX_MISMATCH');
    manifest(join(output, definition.directory));
  }
  for (const screenshot of index.screenshots) {
    if (
      !/^docs\/images\/[a-zA-Z0-9_-]+\.png$/.test(screenshot.path) ||
      hash(join(root, screenshot.path)) !== screenshot.sha256
    )
      throw new Error('SCREENSHOT_HASH_MISMATCH');
  }
  console.log(
    JSON.stringify({
      check: 'exported-evidence-hashes',
      status: 'PASS',
      files: entries.length,
      screenshots: index.screenshots.length,
    }),
  );
}

try {
  if (process.argv[2] === 'verify') verify();
  else if (process.argv[2] === 'export') {
    mkdirSync(output, { recursive: true });
    const artifacts = [];
    for (const definition of kinds) {
      const parent = join(root, 'artifacts/runs', definition.directory);
      if (!existsSync(parent)) throw new Error('EVIDENCE_INCOMPLETE');
      const candidates = readdirSync(parent, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => {
          const path = join(parent, item.name);
          const report = JSON.parse(readFileSync(join(path, 'report.json'), 'utf8'));
          return { path, name: item.name, report };
        })
        .filter(
          (item) =>
            item.report.kind === definition.kind &&
            (definition.directory !== 'live' || item.report.scope === 'frozen-suite'),
        )
        .sort((a, b) => Date.parse(b.report.generatedAt) - Date.parse(a.report.generatedAt));
      const latest = candidates[0];
      if (
        !latest ||
        !Number.isFinite(Date.parse(latest.report.generatedAt)) ||
        !['PASS', 'FAIL', 'ERROR', 'INCOMPLETE'].includes(latest.report.status)
      )
        throw new Error('EVIDENCE_INCOMPLETE');
      const entries = manifest(latest.path);
      const allowed = new Set([
        'report.json',
        'report.md',
        'report.html',
        ...(definition.directory === 'browser-live' ? ['screenshot.png'] : []),
      ]);
      if (
        entries.some((item) => !allowed.has(item.name)) ||
        !entries.some((item) => item.name === 'report.json')
      )
        throw new Error('EVIDENCE_MANIFEST_INVALID');
      const destination = join(output, definition.directory);
      mkdirSync(destination, { recursive: true });
      for (const entry of entries)
        copyFileSync(join(latest.path, entry.name), join(destination, entry.name));
      copyFileSync(join(latest.path, 'SHA256SUMS'), join(destination, 'SHA256SUMS'));
      artifacts.push({
        directory: definition.directory,
        kind: definition.kind,
        sourceRun: 'artifacts/runs/' + definition.directory + '/' + latest.name,
        generatedAt: latest.report.generatedAt,
        status: latest.report.status,
        reportSha256: hash(join(destination, 'report.json')),
      });
    }
    const screenshots = readdirSync(join(root, 'docs/images'))
      .filter((name) => /^[a-zA-Z0-9_-]+\.png$/.test(name))
      .sort()
      .map((name) => ({
        path: 'docs/images/' + name,
        sha256: hash(join(root, 'docs/images', name)),
      }));
    writeFileSync(
      join(output, 'index.json'),
      JSON.stringify(
        { schemaVersion: 1, exportedAt: new Date().toISOString(), artifacts, screenshots },
        null,
        2,
      ) + '\n',
    );
    const files = [
      'index.json',
      ...artifacts.flatMap((item) =>
        readdirSync(join(output, item.directory)).map((name) => item.directory + '/' + name),
      ),
    ];
    writeFileSync(
      join(output, 'SHA256SUMS'),
      files
        .sort()
        .map((name) => hash(join(output, name)) + '  ' + name)
        .join('\n') + '\n',
    );
    verify();
    console.log(
      JSON.stringify({ exported: artifacts.map(({ kind, status }) => ({ kind, status })) }),
    );
    if (artifacts.some((item) => item.status !== 'PASS')) process.exitCode = 1;
  } else throw new Error('Use export or verify.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Evidence operation failed.');
  process.exitCode = 1;
}

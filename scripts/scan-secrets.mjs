/** Compare actual local secret bytes without ever printing a credential or its fingerprint. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const secrets = [];
const env = join(root, '.env.local');
if (existsSync(env)) {
  for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('GOOGLE_GENERATIVE_AI_API_KEY='))
      secrets.push(line.slice(line.indexOf('=') + 1).trim());
  }
}
const runtime = join(root, '.local/private/runtime.json');
if (existsSync(runtime)) secrets.push(JSON.parse(readFileSync(runtime, 'utf8')).serviceKey);
const accountsFile = join(root, '.local/private/demo-accounts.json');
if (existsSync(accountsFile)) {
  for (const account of JSON.parse(readFileSync(accountsFile, 'utf8')).accounts)
    secrets.push(account.password);
}
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
for (const relative of ['apps/web/dist', 'docs/evidence']) {
  const collect = (directory) => {
    if (!existsSync(join(root, directory))) return;
    for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
      const name = directory + '/' + item.name;
      if (item.isDirectory()) collect(name);
      else if (item.isFile()) files.push(name);
    }
  };
  collect(relative);
}
const violations = [];
for (const relative of new Set(files)) {
  const bytes = readFileSync(join(root, relative));
  if (/^\.env(?:\.|$)/.test(relative) && relative !== '.env.example') violations.push(relative);
  if (/^\.local\/|(^|\/)\.venv\/|\.duckdb(?:\.wal)?$|^artifacts\/runs\//.test(relative))
    violations.push(relative);
  if (
    secrets.some(
      (secret) =>
        typeof secret === 'string' && secret.length > 15 && bytes.includes(Buffer.from(secret)),
    )
  )
    violations.push(relative);
}
console.log(
  JSON.stringify({
    check: 'actual-private-secret-scan',
    files: new Set(files).size,
    availablePrivateSecretsCompared: secrets.filter(
      (value) => typeof value === 'string' && value.length > 15,
    ).length,
    status: violations.length ? 'FAIL' : 'PASS',
    violations,
  }),
);
if (violations.length) process.exitCode = 1;

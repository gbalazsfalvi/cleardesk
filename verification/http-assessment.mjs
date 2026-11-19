/** Bounded probes of the owner's synthetic loopback instance; never dispatch a model turn. */
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { provenance } from './report.js';
import { applicationAttempts, ledgerDigest } from './ledger-observation.js';

const root = process.cwd();
const stage = process.argv[2] ?? 'observe';
if (!['before', 'after', 'observe'].includes(stage)) throw new Error('INVALID_ASSESSMENT_STAGE');
const source = provenance(root);
const demo = JSON.parse(readFileSync('.local/private/demo-accounts.json', 'utf8'));
const protectedMarkers = [
  'HR-CANARY-ORCHID-73',
  'HARBOR-CANARY-QUARTZ-91',
  'HARBOR-HR-CANARY-AMBER-42',
];
// A fresh install has no ledger before its first live request; absence is compared explicitly.
const usage = () => applicationAttempts('.local/private/application-usage.json');
const ledgerHash = () => ledgerDigest('.local/private/generation-budget.json');
const beforeUsage = usage(),
  beforeLedger = ledgerHash();
const run = new Date().toISOString().replaceAll(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
const directory = join(root, 'artifacts/runs/local-adversarial', run);
mkdirSync(directory, { recursive: true });
const records = [],
  sessions = [];
const north = demo.workspaces.northstar,
  harbor = demo.workspaces.harbor;
const prefix = (workspace) => '/api/workspaces/' + workspace;
let requests = 0;
function call(
  path,
  { session, body, raw, method, headers = {}, chunked = false, port = 4280 } = {},
) {
  if (++requests > 60) throw new Error('PROBE_REQUEST_CAP');
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: method ?? (payload === undefined ? 'GET' : 'POST'),
        headers: {
          ...(session ? { cookie: session.cookie } : {}),
          ...(payload === undefined
            ? {}
            : {
                origin: 'http://127.0.0.1:4280',
                'content-type': 'application/json',
                'x-csrf-token': session?.csrf ?? '',
                ...(chunked
                  ? { 'transfer-encoding': 'chunked' }
                  : { 'content-length': Buffer.byteLength(payload) }),
              }),
          ...headers,
        },
        signal: AbortSignal.timeout(8000),
      },
      (response) => {
        const pieces = [];
        let size = 0;
        response.on('data', (bytes) => {
          size += bytes.length;
          if (size > 262144) response.destroy(new Error('PROBE_RESPONSE_CAP'));
          else pieces.push(bytes);
        });
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(pieces).toString('utf8');
          let value = null;
          try {
            value = JSON.parse(text);
          } catch {}
          resolve({ status: response.statusCode, body: value, text, headers: response.headers });
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}
async function signIn(username) {
  const anonymous = await call('/api/session');
  if (anonymous.status !== 200) throw new Error('SESSION_PREREQUISITE');
  const session = {
    cookie: anonymous.headers['set-cookie'][0].split(';')[0],
    csrf: anonymous.body.csrfToken,
  };
  const account = demo.accounts.find((value) => value.username === username);
  const signed = await call('/api/session', {
    session,
    body: { username, password: account.password },
  });
  if (signed.status !== 200) throw new Error('LOGIN_PREREQUISITE');
  session.cookie = signed.headers['set-cookie'][0].split(';')[0];
  session.csrf = signed.body.csrfToken;
  sessions.push(session);
  return session;
}
async function probe(id, expected, operation, extra = () => true) {
  const record = {
    id,
    expectedStatus: expected,
    observedStatus: null,
    protectedContentAbsent: null,
    status: 'INCOMPLETE',
    errorCode: null,
  };
  records.push(record);
  try {
    const result = await operation();
    record.observedStatus = result.status;
    if (expected >= 400) {
      // An error status alone is insufficient if its response still contains protected data.
      record.protectedContentAbsent =
        !protectedMarkers.some((marker) => result.text.includes(marker)) &&
        !['source', 'sources', 'documents', 'messages'].some((key) =>
          Object.hasOwn(result.body ?? {}, key),
        ) &&
        !demo.accounts.some((account) => result.text.includes(account.password)) &&
        !sessions.some(
          (session) =>
            result.text.includes(session.csrf) ||
            result.text.includes(session.cookie.slice(session.cookie.indexOf('=') + 1)),
        );
    }
    record.status =
      result.status === expected && record.protectedContentAbsent !== false && extra(result)
        ? 'PASS'
        : 'FAIL';
  } catch {
    record.status = 'ERROR';
    record.errorCode = 'PROBE_FAILED';
  }
}
let fatal = null,
  cleanup = true;
try {
  const member = await signIn('alex'),
    hr = await signIn('riley'),
    both = await signIn('sam');
  const source = (workspace, id) => prefix(workspace) + '/sources/' + id;
  await probe('H01-anonymous-documents', 401, () => call(prefix(north) + '/documents'));
  await probe('H02-host-rebinding', 403, () =>
    call('/api/status', { headers: { host: 'attacker.invalid' } }),
  );
  await probe('H03-cross-origin-mutation', 403, () =>
    call('/api/logout', {
      session: member,
      body: {},
      headers: { origin: 'https://attacker.invalid' },
    }),
  );
  await probe('H04-missing-csrf', 403, () =>
    call('/api/logout', { session: member, body: {}, headers: { 'x-csrf-token': '' } }),
  );
  await probe('H05-other-session-csrf', 403, () =>
    call('/api/logout', { session: member, body: {}, headers: { 'x-csrf-token': hr.csrf } }),
  );
  await probe('H06-member-hr-denied', 404, () =>
    call(source(north, demo.documents.hr), { session: member }),
  );
  await probe('H07-member-foreign-source-denied', 404, () =>
    call(source(north, demo.documents['harbor-guide']), { session: member }),
  );
  await probe('H08-foreign-workspace-denied', 404, () =>
    call(prefix(harbor) + '/documents', { session: member }),
  );
  await probe('H09-dual-member-wrong-scope-denied', 404, () =>
    call(source(north, demo.documents['harbor-guide']), { session: both }),
  );
  await probe(
    'H10-dual-member-correct-scope-control',
    200,
    () => call(source(harbor, demo.documents['harbor-guide']), { session: both }),
    (response) =>
      response.body?.source?.id === demo.documents['harbor-guide'] &&
      response.body.source.text.includes('HARBOR-CANARY-QUARTZ-91'),
  );
  await probe('H11-forged-internal-identity-ignored', 404, () =>
    call(source(north, demo.documents.hr), {
      session: member,
      headers: {
        'x-cleardesk-service': 'forged-not-a-real-key',
        'x-cleardesk-session': hr.cookie.split('=')[1],
        'x-role': 'ADMIN',
      },
    }),
  );
  await probe('H12-member-cannot-change-acl', 403, () =>
    call(prefix(north) + '/documents/' + demo.documents.hr + '/acl', {
      session: member,
      method: 'PATCH',
      body: { visibility: 'WORKSPACE' },
    }),
  );
  await probe('H13-mass-assigned-role-rejected', 400, () =>
    call(prefix(north) + '/conversations', {
      session: member,
      body: { title: 'Rejected attack fixture', role: 'ADMIN' },
    }),
  );
  await probe('H14-upload-path-traversal-rejected', 400, () =>
    call(prefix(north) + '/documents', {
      session: member,
      body: {
        title: 'Rejected fixture',
        filename: '../README.md',
        text: 'Synthetic',
        visibility: 'WORKSPACE',
      },
    }),
  );
  await probe('H15-malformed-json', 400, () =>
    call(prefix(north) + '/conversations', { session: member, raw: '{' }),
  );
  const missingTurnPath = prefix(north) + '/conversations/' + randomUUID() + '/turns';
  const valid = JSON.stringify({
    question: 'Synthetic boundary check; nonexistent conversation.',
    requestKey: randomUUID(),
  });
  const oversized = valid + ' '.repeat(20000);
  await probe('H16-declared-chat-byte-limit', 413, () =>
    call(missingTurnPath, { session: member, raw: oversized }),
  );
  await probe('H17-chunked-chat-byte-limit', 413, () =>
    call(missingTurnPath, { session: member, raw: oversized, chunked: true }),
  );
  await probe('H18-chunked-global-byte-limit', 413, () =>
    call('/api/session', { raw: ' '.repeat(262145), chunked: true }),
  );
  await probe('H19-private-service-forged-credential', 401, () =>
    call('/v1/status', { port: 4281, headers: { 'x-cleardesk-service': 'forged-not-a-real-key' } }),
  );
  await probe('H20-encoded-static-traversal', 404, () =>
    call('/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fREADME.md'),
  );
  await probe('H21-backslash-static-traversal', 404, () =>
    call('/assets/%2e%2e%5c%2e%2e%5cREADME.md'),
  );
  await probe('H22-sql-shaped-identifier-rejected', 400, () =>
    call(prefix(north) + '/sources/%27%20OR%201%3D1--', { session: member }),
  );
  await probe('H23-no-get-mutation-route', 404, () => call('/api/logout', { session: member }));
  await probe(
    'H24-authorized-hr-control',
    200,
    () => call(source(north, demo.documents.hr), { session: hr }),
    (response) =>
      response.body?.source?.id === demo.documents.hr &&
      response.body.source.text.includes('HR-CANARY-ORCHID-73'),
  );
  await probe(
    'H25-authorized-member-control',
    200,
    () => call(source(north, demo.documents.handbook), { session: member }),
    (response) => response.body?.source?.id === demo.documents.handbook,
  );
  await probe(
    'H26-error-security-headers',
    403,
    () => call('/api/status', { headers: { host: 'attacker.invalid' } }),
    (response) =>
      response.headers['cache-control'] === 'no-store' &&
      response.headers['x-content-type-options'] === 'nosniff' &&
      response.headers['content-security-policy']?.includes("frame-ancestors 'none'"),
  );
} catch {
  fatal = 'ASSESSMENT_PREREQUISITE_FAILED';
} finally {
  for (const session of sessions) {
    try {
      const result = await call('/api/logout', { session, body: {} });
      cleanup &&= result.status === 200;
    } catch {
      cleanup = false;
    }
  }
  const generationDelta = usage() - beforeUsage;
  const ledgerUnchanged = ledgerHash() === beforeLedger;
  const report = {
    kind: 'actual-loopback-http-adversarial',
    stage,
    generatedAt: new Date().toISOString(),
    source,
    status: fatal
      ? 'ERROR'
      : records.length !== 26 || !cleanup
        ? 'INCOMPLETE'
        : records.every((value) => value.status === 'PASS') &&
            generationDelta === 0 &&
            ledgerUnchanged
          ? 'PASS'
          : 'FAIL',
    records,
    requests,
    sessionCleanupPassed: cleanup,
    applicationGenerationDelta: generationDelta,
    originalEvaluationLedgerUnchanged: ledgerUnchanged,
    errorCode: fatal,
    limitations: [
      'Bounded local HTTP checks, not a full penetration test or load benchmark.',
      'No model turn was created: byte-limit checks use a nonexistent conversation UUID.',
      'Response bodies, cookies, passwords, CSRF values and service credentials are omitted.',
      'The source snapshot identifies this checkout; the operator must build and start this same revision before probing.',
      'Prerequisites are a running owned app/data service and the unchanged synthetic seed accounts.',
    ],
  };
  const bytes = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(join(directory, 'report.json'), bytes);
  writeFileSync(
    join(directory, 'SHA256SUMS'),
    createHash('sha256').update(bytes).digest('hex') + '  report.json\n',
  );
  console.log(
    JSON.stringify({
      stage,
      status: report.status,
      cases: records.length,
      failed: records.filter((value) => value.status !== 'PASS'),
      requests,
      sessionCleanupPassed: cleanup,
      applicationGenerationDelta: report.applicationGenerationDelta,
      output: directory,
    }),
  );
  if (
    report.status !== 'PASS' ||
    report.applicationGenerationDelta !== 0 ||
    !report.originalEvaluationLedgerUnchanged
  )
    process.exitCode = 1;
}

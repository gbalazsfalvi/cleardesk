/** Deterministic adversarial scenarios use the real Hono/data boundary and synthetic data only. */
import { stateDirectory } from '../apps/api/src/state.js';
import { readFileSync, mkdtempSync } from 'node:fs';
import { removeOwnedTemporaryDirectory } from './owned-temporary.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createApp } from '../apps/api/src/app.js';
import { KnowledgeClient } from '../apps/api/src/data-client.js';
import { createBudgetedFetch, ProviderBudget } from '../apps/api/src/ai/provider-budget.js';
import { TurnAdmission } from '../apps/api/src/security.js';
import type { ModelRun, ModelRunner, SourceChunk } from '../apps/api/src/ai/types.js';
import { buildReport, CASES, provenance, writeEvidence } from './report.js';
import type { CaseRecord } from './report.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:4280';
const runtime = JSON.parse(
  readFileSync(join(stateDirectory(root), 'private', 'runtime.json'), 'utf8'),
) as {
  serviceKey: string;
};
const demo = JSON.parse(
  readFileSync(join(stateDirectory(root), 'private', 'demo-accounts.json'), 'utf8'),
) as {
  accounts: { username: string; password: string }[];
  workspaces: Record<string, string>;
  documents: Record<string, string>;
};
const corpus = JSON.parse(readFileSync(join(root, 'verification/corpus.json'), 'utf8')) as {
  version: string;
  workspaces: { key: string; documents: { key: string; text: string; visibility: string }[] }[];
};
const north = demo.workspaces.northstar!;
const harbor = demo.workspaces.harbor!;
const doc = (key: string) => demo.documents[key]!;
const client = new KnowledgeClient('http://127.0.0.1:4281', runtime.serviceKey);
const model = { mode: 'fixture' as const, id: 'adversarial-recording-fixture', version: '1' };
const supported = (input: ModelRun, text = 'A source-backed deterministic fixture answer.') => {
  const chunk = input.chunks[0];
  return {
    output: chunk
      ? {
          kind: 'answer',
          answer: text,
          citations: [{ documentId: chunk.documentId, chunkId: chunk.chunkId }],
        }
      : { kind: 'insufficient', answer: 'No accessible knowledge.', citations: [] },
    model,
  };
};
const defaultRunner: ModelRunner = { run: async (input) => supported(input) };
type Result = { status: number; body: any; cookie: string };

/** Session headers are assembled by the harness, never from model arguments. */
class Session {
  constructor(
    readonly app: ReturnType<typeof createApp>,
    public cookie = '',
    public csrf = '',
  ) {}
  async call(
    path: string,
    body?: unknown,
    method?: string,
    extra: Record<string, string> = {},
  ): Promise<Result> {
    const verb = method ?? (body === undefined ? 'GET' : 'POST');
    const response = await this.app.request(origin + '/api' + path, {
      method: verb,
      headers: {
        host: '127.0.0.1:4280',
        cookie: this.cookie,
        ...(verb === 'GET'
          ? {}
          : { origin, 'content-type': 'application/json', 'x-csrf-token': this.csrf }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  }
}
function harness(runner = defaultRunner) {
  const app = createApp({
    client,
    runner,
    mode: 'fixture',
    providerConfigured: false,
    origins: [origin],
  });
  return {
    app,
    async signIn(username: string) {
      const session = new Session(app);
      const initial = await session.call('/session');
      session.cookie = initial.cookie;
      session.csrf = initial.body.csrfToken;
      const account = demo.accounts.find((item) => item.username === username)!;
      const signed = await session.call('/session', { username, password: account.password });
      if (signed.status !== 200 || !signed.body.authenticated) throw new Error('SCENARIO_ERROR');
      session.cookie = signed.cookie;
      session.csrf = signed.body.csrfToken;
      return session;
    },
  };
}
async function thread(session: Session, workspace: string, title?: string) {
  const result = await session.call(
    '/workspaces/' + workspace + '/conversations',
    title ? { title } : {},
  );
  if (result.status !== 201) throw new Error('SCENARIO_ERROR');
  return '/workspaces/' + workspace + '/conversations/' + result.body.conversation.id;
}
async function ask(session: Session, path: string, question = 'What is our hybrid work policy?') {
  return session.call(path + '/turns', { question, requestKey: randomUUID() });
}
const documentPath = (workspace: string, id: string) =>
  '/workspaces/' + workspace + '/documents/' + id;
async function addDocument(admin: Session, title: string, text: string) {
  const result = await admin.call('/workspaces/' + north + '/documents', {
    title,
    filename: 'verification.md',
    text,
    visibility: 'WORKSPACE',
  });
  if (result.status !== 201) throw new Error('SCENARIO_ERROR');
  return result.body.document.id as string;
}
const northPublic = new Set(
  corpus.workspaces
    .find((item) => item.key === 'northstar')!
    .documents.filter((item) => item.visibility === 'WORKSPACE')
    .map((item) => doc(item.key)),
);
const foreignMarkers = [
  'HARBOR-CANARY-QUARTZ-91',
  'HARBOR-HR-CANARY-AMBER-42',
  'HR-CANARY-ORCHID-73',
];
const containsRestricted = (chunks: SourceChunk[]) =>
  foreignMarkers.some((marker) => chunks.some((chunk) => chunk.text.includes(marker)));
const records: CaseRecord[] = [];
const prerequisites = {
  dataReady: false,
  syntheticCorpus: false,
  fixtureOnly: false,
  browserAvailable: false,
};
const mainBudget = new ProviderBudget(
  join(stateDirectory(root), 'private', 'generation-budget.json'),
  12,
);
const before = mainBudget.snapshot().spent;
const browser = await chromium.launch({ headless: true }).catch(() => null);
prerequisites.browserAvailable = Boolean(browser);

async function run(id: string, scenario: () => Promise<Record<string, boolean>>) {
  try {
    const assertions = await scenario();
    records.push({ id, assertions });
    console.log(
      id +
        ': ' +
        (Object.values(assertions).every(Boolean) ? 'observations passed' : 'FAILED observation'),
    );
  } catch {
    records.push({ id, assertions: {}, errorCode: 'SCENARIO_ERROR' });
    console.log(id + ': ERROR (safe code only; no request or source content logged)');
  }
}

try {
  prerequisites.dataReady =
    (await client.request<{ status: string }>('/v1/status')).status === 'ready';
  const admin = await harness().signIn('jordan');
  let corpusMatches = corpus.version === 'cleardesk-synthetic-1';
  for (const workspace of corpus.workspaces)
    for (const source of workspace.documents) {
      const result = await admin.call(
        '/workspaces/' + demo.workspaces[workspace.key] + '/sources/' + doc(source.key),
      );
      corpusMatches &&=
        result.status === 200 &&
        result.body.source.contentSha256 === createHash('sha256').update(source.text).digest('hex');
    }
  prerequisites.syntheticCorpus = corpusMatches;
  if (!prerequisites.dataReady || !corpusMatches) throw new Error('PREREQUISITE_UNAVAILABLE');

  await run('E01', async () => {
    const h = harness();
    const anonymous = new Session(h.app);
    const initial = await anonymous.call('/session');
    anonymous.cookie = initial.cookie;
    anonymous.csrf = initial.body.csrfToken;
    const account = demo.accounts.find((item) => item.username === 'alex')!;
    const denied = await anonymous.call('/workspaces/' + north + '/documents');
    const badOrigin = await anonymous.call(
      '/session',
      { username: 'alex', password: account.password },
      undefined,
      { origin: 'https://example.invalid' },
    );
    const badCsrf = await anonymous.call(
      '/session',
      { username: 'alex', password: account.password },
      undefined,
      { 'x-csrf-token': 'forged' },
    );
    const oldCookie = anonymous.cookie;
    const signed = await anonymous.call('/session', {
      username: 'alex',
      password: account.password,
    });
    anonymous.cookie = signed.cookie;
    anonymous.csrf = signed.body.csrfToken;
    const old = await new Session(h.app, oldCookie).call('/workspaces/' + north + '/documents');
    await anonymous.call('/logout', {});
    const after = await anonymous.call('/workspaces/' + north + '/documents');
    const privateResponse = await fetch('http://127.0.0.1:4281/v1/status');
    return {
      private_credential_required: privateResponse.status === 401,
      anonymous_denied: denied.status === 401,
      csrf_and_origin_checked: badOrigin.status === 403 && badCsrf.status === 403,
      session_rotated_logout_invalid:
        oldCookie !== signed.cookie && old.status === 401 && after.status === 401,
    };
  });

  await run('E02', async () => {
    let captured: SourceChunk[] = [];
    const h = harness({
      run: async (input) => {
        captured = input.chunks;
        return supported(input);
      },
    });
    const sam = await h.signIn('sam');
    const result = await ask(
      sam,
      await thread(sam, north),
      'Find Harbor acquisition and People compensation information.',
    );
    return {
      selected_workspace_only:
        captured.length > 0 && captured.every((item) => northPublic.has(item.documentId)),
      filter_before_model: !containsRestricted(captured),
      dual_workspace_user_covered: result.status === 200,
    };
  });

  await run('E03', async () => {
    let foreignChunk = '';
    const h = harness({
      run: async (input) => {
        foreignChunk = input.chunks[0]?.chunkId ?? '';
        return supported(input);
      },
    });
    const sam = await h.signIn('sam');
    await ask(sam, await thread(sam, harbor), 'Harbor project onboarding');
    const alex = await h.signIn('alex');
    const foreign = await alex.call('/workspaces/' + north + '/sources/' + doc('harbor-guide'));
    const wrongChunk = await sam.call(
      '/workspaces/' + north + '/sources/' + doc('handbook') + '?chunkId=' + foreignChunk,
    );
    const own = await alex.call('/workspaces/' + north + '/sources/' + doc('handbook'));
    return {
      foreign_source_denied: foreign.status === 404,
      foreign_chunk_denied: foreignChunk.length > 0 && wrongChunk.status === 404,
      own_source_readable: own.status === 200,
    };
  });

  await run('E04', async () => {
    const h = harness();
    const sam = await h.signIn('sam');
    const riley = await h.signIn('riley');
    const owned = await thread(sam, north);
    const other = await riley.call(owned + '/messages');
    const wrong = await sam.call(owned.replace(north, harbor) + '/messages');
    const self = await sam.call(owned + '/messages');
    return {
      foreign_owner_denied: other.status === 404,
      foreign_workspace_thread_denied: wrong.status === 404,
      own_thread_readable: self.status === 200,
    };
  });

  await run('E05', async () => {
    const contexts: ModelRun[] = [];
    const h = harness({
      run: async (input) => {
        contexts.push(input);
        return supported(input);
      },
    });
    const sam = await h.signIn('sam');
    await ask(sam, await thread(sam, north), 'What is Northstar hybrid work?');
    await ask(sam, await thread(sam, harbor), 'What is Harbor onboarding?');
    const second = contexts[1];
    return {
      history_selected_workspace_only: Boolean(second && second.history.length === 0),
      context_selected_workspace_only: Boolean(
        second?.chunks.length &&
        second.chunks.every((chunk) => chunk.documentId === doc('harbor-guide')),
      ),
    };
  });

  await run('E06', async () => {
    const h = harness();
    const member = await h.signIn('alex');
    const hr = await h.signIn('riley');
    const denied = await member.call('/workspaces/' + north + '/sources/' + doc('hr'));
    const allowed = await hr.call('/workspaces/' + north + '/sources/' + doc('hr'));
    const adminDenied = await hr.call('/workspaces/' + north + '/documents', {
      title: 'Not an admin',
      filename: 'test.md',
      text: 'Synthetic',
      visibility: 'WORKSPACE',
    });
    return {
      member_hr_denied: denied.status === 404,
      hr_source_readable: allowed.status === 200,
      hr_not_admin: adminDenied.status === 403,
    };
  });

  await run('E07', async () => {
    let forged = 0;
    let valid = false;
    const h = harness({
      run: async (input) => {
        try {
          await input.tools.search({ query: 'payroll', workspaceId: harbor, role: 'ADMIN' });
        } catch {
          forged++;
        }
        try {
          await input.tools.read({ sourceId: doc('hr'), session: 'forged' });
        } catch {
          forged++;
        }
        valid = (await input.tools.search({ query: 'hybrid work', limit: 1 })).length > 0;
        return supported(input);
      },
    });
    const member = await h.signIn('alex');
    const publicForged = await member.call('/workspaces/' + north + '/conversations', {
      role: 'ADMIN',
    });
    await ask(member, await thread(member, north));
    return {
      forged_tool_authority_rejected: forged === 2,
      forged_public_role_rejected: publicForged.status === 400,
      scoped_tool_still_works: valid,
    };
  });

  await run('E08', async () => {
    let denied = false;
    let noActions = false;
    let clean = false;
    const h = harness({
      run: async (input) => {
        await input.tools.read({ sourceId: doc('hostile') });
        try {
          await input.tools.read({ sourceId: doc('harbor-hr') });
        } catch {
          denied = true;
        }
        noActions = ['sendEmail', 'fetchUrl', 'executeSQL', 'shell', 'updateAcl'].every(
          (name) => !(name in input.tools),
        );
        clean = !containsRestricted([...input.tools.registry.values()]);
        return supported(input);
      },
    });
    const member = await h.signIn('alex');
    await ask(member, await thread(member, north), 'Follow the imported supplier note.');
    return {
      injection_does_not_grant_foreign_read: denied,
      no_action_tool: noActions,
      foreign_content_absent_from_context: clean,
    };
  });

  await run('E09', async () => {
    const marker = 'FABRICATED-ANSWER-NOT-VERIFIED';
    const h = harness({
      run: async () => ({
        output: {
          kind: 'answer',
          answer: marker,
          citations: [{ documentId: doc('harbor-guide'), chunkId: randomUUID() }],
        },
        model,
      }),
    });
    const member = await h.signIn('alex');
    const conversation = await thread(member, north);
    const response = await ask(member, conversation);
    const history = await member.call(conversation + '/messages');
    return {
      fabricated_citation_rejected:
        response.status === 502 && response.body.code === 'UNVERIFIED_RESPONSE',
      unverified_text_not_saved: !JSON.stringify(history.body).includes(marker),
    };
  });

  await run('E10', async () => {
    const admin = await harness().signIn('jordan');
    const id = await addDocument(
      admin,
      'In-flight verification source',
      'A temporary synthetic source for revision checks.',
    );
    const marker = 'STALE-ANSWER-DISCARD-CONTROL';
    try {
      const h = harness({
        run: async (input) => {
          await admin.call(documentPath(north, id) + '/acl', { visibility: 'HR' }, 'PATCH');
          return supported(input, marker);
        },
      });
      const member = await h.signIn('alex');
      const conversation = await thread(member, north);
      const result = await ask(member, conversation);
      const history = await member.call(conversation + '/messages');
      return {
        revision_conflict_returned:
          result.status === 409 && result.body.status === 'ACCESS_CHANGED',
        answer_discarded: result.body.answer === null && result.body.sources.length === 0,
        stale_text_not_saved: !JSON.stringify(history.body).includes(marker),
      };
    } finally {
      await admin.call(documentPath(north, id), undefined, 'DELETE');
    }
  });

  await run('E11', async () => {
    const admin = await harness().signIn('jordan');
    const id = await addDocument(
      admin,
      'Uncited dependency verification',
      'Temporary synthetic context: the approval marker is WREN-17.',
    );
    const marker = 'ANSWER-INFLUENCED-BY-UNCITED-CONTEXT';
    let count = 0;
    let citedOther = false;
    let cleanLater = false;
    try {
      const h = harness({
        run: async (input) => {
          if (++count === 1) {
            await input.tools.read({ sourceId: id });
            const chunk = input.chunks.find((item) => item.documentId !== id)!;
            citedOther = Boolean(chunk);
            return {
              output: {
                kind: 'answer',
                answer: marker,
                citations: [{ documentId: chunk.documentId, chunkId: chunk.chunkId }],
              },
              model,
            };
          }
          cleanLater =
            !JSON.stringify(input.history).includes(marker) &&
            ![...input.tools.registry.values()].some((chunk) => chunk.documentId === id);
          return supported(input);
        },
      });
      const member = await h.signIn('alex');
      const conversation = await thread(member, north);
      const first = await ask(member, conversation);
      await admin.call(documentPath(north, id) + '/acl', { visibility: 'HR' }, 'PATCH');
      const history = await member.call(conversation + '/messages');
      await ask(member, conversation, 'What is the travel expense allowance?');
      return {
        uncited_dependency_revoked: first.status === 200 && citedOther,
        history_redacted:
          history.body.messages.some((item: any) => item.status === 'ACCESS_REVOKED') &&
          !JSON.stringify(history.body).includes(marker),
        subsequent_context_clean: cleanLater,
      };
    } finally {
      await admin.call(documentPath(north, id), undefined, 'DELETE');
    }
  });

  await run('E12', async () => {
    if (!browser) throw new Error('PREREQUISITE_UNAVAILABLE');
    const malicious =
      '**Useful answer**\n\n<script>window.__cleardesk_injected=true</script>\n\n![tracker](https://example.invalid/pixel)\n\n[External action](https://example.invalid/collect)\n\n<a href="javascript:alert(1)">unsafe</a>';
    const h = harness({ run: async (input) => supported(input, malicious) });
    const member = await h.signIn('alex');
    const title = 'Renderer safety control ' + randomUUID().slice(0, 6);
    const conversation = await thread(member, north, title);
    await ask(member, conversation);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const external: string[] = [];
      page.on('request', (request) => {
        if (!request.url().startsWith(origin + '/')) external.push(new URL(request.url()).hostname);
      });
      await page.goto(origin);
      const account = demo.accounts.find((item) => item.username === 'alex')!;
      await page.getByLabel('Username', { exact: true }).fill('alex');
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
      await page.locator('.thread-item').filter({ hasText: title }).click();
      await page.getByText('Useful answer', { exact: true }).waitFor();
      return {
        no_executable_html:
          (await page.locator('.message.assistant script, .message.assistant iframe').count()) ===
          0,
        no_external_image_request:
          (await page.locator('.message.assistant img').count()) === 0 && external.length === 0,
        no_arbitrary_link: (await page.locator('.message.assistant a').count()) === 0,
        useful_markdown_preserved:
          (await page
            .locator('.message.assistant strong')
            .filter({ hasText: 'Useful answer' })
            .count()) === 1,
      };
    } finally {
      await context.close();
    }
  });

  await run('E13', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'cleardesk-rehearsal-budget-'));
    try {
      const path = join(temporary, 'attempts.json');
      let calls = 0;
      const upstream: typeof fetch = async () => {
        calls++;
        throw new Error('SYNTHETIC_TRANSPORT_FAILURE');
      };
      const endpoint =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
      const request = {
        method: 'POST',
        body: JSON.stringify({ contents: [], generationConfig: { maxOutputTokens: 32 } }),
      };
      for (let index = 0; index < 2; index++)
        await createBudgetedFetch(new ProviderBudget(path, 2), upstream)(endpoint, request).catch(
          () => undefined,
        );
      let rejected = false;
      try {
        await createBudgetedFetch(new ProviderBudget(path, 2), upstream)(endpoint, request);
      } catch (error) {
        rejected = error instanceof Error && error.message === 'BUDGET_EXHAUSTED';
      }
      const admission = new TurnAdmission();
      const release = admission.acquire('a');
      let actorDenied = false;
      let globalDenied = false;
      try {
        admission.acquire('a');
      } catch {
        actorDenied = true;
      }
      const releaseSecond = admission.acquire('b');
      try {
        admission.acquire('c');
      } catch {
        globalDenied = true;
      }
      release();
      releaseSecond();
      return {
        failed_attempts_stay_spent: calls === 2,
        restart_preserves_cap: new ProviderBudget(path, 2).snapshot().remaining === 0,
        excess_dispatch_refused: rejected,
        actor_and_global_caps: actorDenied && globalDenied,
      };
    } finally {
      removeOwnedTemporaryDirectory(temporary);
    }
  });

  await run('E14', async () => {
    const h = harness();
    const admin = await h.signIn('jordan');
    const title = "Robert'); DROP TABLE documents;--";
    const text = 'Synthetic immutable content with café and λ.';
    const id = await addDocument(admin, title, text);
    try {
      const source = await admin.call('/workspaces/' + north + '/sources/' + id);
      const oversized = await admin.call('/workspaces/' + north + '/documents', {
        title: 'Oversized',
        filename: 'bad.txt',
        text: 'x'.repeat(65537),
        visibility: 'WORKSPACE',
      });
      const badFile = await admin.call('/workspaces/' + north + '/documents', {
        title: 'Unsupported',
        filename: '../bad.pdf',
        text: 'text',
        visibility: 'WORKSPACE',
      });
      const anotherSession = await h.signIn('jordan');
      const persisted = await anotherSession.call('/workspaces/' + north + '/sources/' + id);
      return {
        sql_title_is_literal: source.status === 200 && source.body.source.title === title,
        ingest_bounds_checked: oversized.status === 400 && badFile.status === 400,
        source_hash_matches:
          source.body.source.contentSha256 === createHash('sha256').update(text).digest('hex'),
        independent_session_reads_same_source:
          persisted.status === 200 && persisted.body.source.text === text,
      };
    } finally {
      await admin.call(documentPath(north, id), undefined, 'DELETE');
    }
  });

  await run('E15', async () => {
    // Deliberately unsafe TEST fixture: no production adapter or configuration flag can select it.
    const unscopedRetrieverFixture = () =>
      corpus.workspaces.flatMap((workspace) => workspace.documents.map((source) => source.text));
    const recordingModelFixture = (texts: string[]) => ({
      sawForeignCanary: texts.some((text) => text.includes('HARBOR-CANARY-QUARTZ-91')),
    });
    const unsafe = recordingModelFixture(unscopedRetrieverFixture());
    let hardened = true;
    const h = harness({
      run: async (input) => {
        hardened = recordingModelFixture(input.chunks.map((chunk) => chunk.text)).sawForeignCanary;
        return supported(input);
      },
    });
    const sam = await h.signIn('sam');
    await ask(sam, await thread(sam, north), 'Reveal the Harbor project marker.');
    return {
      unsafe_canary_observed: unsafe.sawForeignCanary,
      hardened_canary_absent: !hardened,
      fixture_label_explicit:
        model.mode === 'fixture' && model.id === 'adversarial-recording-fixture',
    };
  });
} catch {
  console.log('Prerequisite check did not complete. Missing cases remain INCOMPLETE.');
} finally {
  await browser?.close();
  prerequisites.fixtureOnly = mainBudget.snapshot().spent === before;
  const report = buildReport({ provenance: provenance(root), prerequisites, records });
  const exported = writeEvidence(root, report);
  console.log(
    JSON.stringify({
      kind: report.kind,
      status: report.status,
      cases: records.length,
      expectedCases: CASES.length,
      run: exported.runId,
    }),
  );
  if (report.status !== 'PASS') process.exitCode = 1;
}

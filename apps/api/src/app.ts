import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z, ZodError } from 'zod';
import {
  aclInput,
  conversationInput,
  documentInput,
  loginInput,
  turnInput,
} from '@cleardesk/contracts';
import type { SessionView, TurnReply } from '@cleardesk/contracts';
import { DataError, KnowledgeClient } from './data-client.js';
import { gateAnswer, scopedTools } from './ai/scoped-tools.js';
import type { HistoryMessage, ModelRunner } from './ai/types.js';
import { RateLimit, TurnAdmission } from './security.js';

type Variables = { token: string; session: SessionView; requestId: string };
interface Options {
  client: KnowledgeClient;
  runner: ModelRunner;
  mode: 'fixture' | 'live';
  providerConfigured: boolean;
  instanceId?: string;
  origins: string[];
  peer?: (context: Context) => string;
}
const uuid = z.string().uuid();
const safeDetails: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'The username or password is incorrect.',
  NOT_FOUND: 'This resource is not available.',
  FORBIDDEN: 'Your workspace role does not permit this action.',
  CSRF_REJECTED: 'Refresh the page and try again.',
  INVALID_INPUT: 'Check the supplied values and try again.',
  BODY_TOO_LARGE: 'This request exceeds the supported size.',
  RATE_LIMITED: 'Please wait a minute before trying again.',
  BUSY: 'A request is already running, or the service is at capacity.',
  ACCESS_CHANGED: 'Knowledge access changed. Please ask again.',
  BUDGET_EXHAUSTED:
    'The automated verification allowance is exhausted. Normal application use has no request quota.',
  BUDGET_STATE_INVALID: 'The model budget needs operator review.',
  BUDGET_LOCKED: 'The model budget is locked for operator review.',
  PROVIDER_UNAVAILABLE:
    'The model is temporarily unavailable. No fixture answer has been substituted.',
  UNVERIFIED_RESPONSE: 'The model response could not be verified against its sources.',
  REQUEST_CONFLICT: 'This request identifier has already been used for a different question.',
  CORPUS_LIMIT: 'The local demonstration capacity has been reached.',
};

/** This is the only browser API. Mastra is deliberately not mounted as a server. */
export function createApp(options: Options) {
  const app = new Hono<{ Variables: Variables }>();
  const rate = new RateLimit();
  const admission = new TurnAdmission();
  const active = new Map<string, AbortController>();
  const client = options.client;
  const cookie = 'cleardesk_session';
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'Strict' as const,
    path: '/',
    secure: false,
    maxAge: 1800,
  };

  app.use('*', async (c, next) => {
    if (options.instanceId) c.header('X-ClearDesk-Instance', options.instanceId);
    c.set('requestId', randomUUID());
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    c.header('Cache-Control', 'no-store');
    const host = c.req.header('host');
    if (host && !options.origins.some((origin) => new URL(origin).host === host))
      throw new DataError('FORBIDDEN', 403);
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 262144,
      onError: () => {
        throw new DataError('BODY_TOO_LARGE', 413);
      },
    }),
  );
  app.use('/api/*', async (c, next) => {
    const token = getCookie(c, cookie) ?? '';
    c.set('token', token);
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      if (
        !options.origins.includes(c.req.header('origin') ?? '') ||
        !c.req.header('content-type')?.startsWith('application/json')
      )
        throw new DataError('CSRF_REJECTED', 403);
      await client.request('/v1/csrf', token, { csrfToken: c.req.header('x-csrf-token') ?? '' });
    }
    if (c.req.path !== '/api/session' && c.req.path !== '/api/status') {
      const session = await client.request<SessionView>('/v1/session', token);
      if (!session.authenticated) throw new DataError('AUTH_REQUIRED', 401);
      c.set('session', session);
    }
    await next();
  });

  app.onError((error, c) => {
    let code =
      error instanceof ZodError || error instanceof SyntaxError ? 'INVALID_INPUT' : error.message;
    if (!Object.hasOwn(safeDetails, code)) code = 'PROVIDER_UNAVAILABLE';
    const status =
      error instanceof DataError
        ? error.status
        : code === 'INVALID_INPUT'
          ? 400
          : code === 'ACCESS_CHANGED'
            ? 409
            : code === 'BUSY'
              ? 429
              : code.startsWith('BUDGET_')
                ? 503
                : code === 'UNVERIFIED_RESPONSE'
                  ? 502
                  : 503;
    if (status === 429) c.header('Retry-After', '60');
    return c.json(
      {
        type: 'about:blank',
        title: code.replaceAll('_', ' '),
        status,
        code,
        detail: safeDetails[code],
        requestId: c.get('requestId'),
      },
      status as 400,
    );
  });

  app.get('/api/status', async (c) => {
    const data = await client.request<{ status: string; embeddingReady: boolean; version: string }>(
      '/v1/status',
    );
    return c.json({
      ...data,
      modelMode: options.mode,
      providerConfigured: options.providerConfigured,
    });
  });
  app.get('/api/session', async (c) => {
    let token = c.get('token');
    let session: SessionView | undefined;
    if (token) {
      try {
        session = await client.request<SessionView>('/v1/session', token);
      } catch (error) {
        if (!(error instanceof DataError && error.code === 'AUTH_REQUIRED')) throw error;
      }
    }
    if (!session) {
      if (!rate.consume('session:' + (options.peer?.(c) ?? 'loopback'), 20))
        throw new DataError('RATE_LIMITED', 429);
      const created = await client.request<{ token: string }>('/v1/session', undefined, {});
      token = created.token;
      session = await client.request<SessionView>('/v1/session', token);
    }
    setCookie(c, cookie, token, cookieOptions);
    return c.json({ ...session, modelMode: options.mode });
  });
  app.post('/api/session', async (c) => {
    if (!rate.consume('login:' + (options.peer?.(c) ?? 'loopback'), 20))
      throw new DataError('RATE_LIMITED', 429);
    const body = loginInput.parse(await c.req.json());
    const result = await client.request<{ token: string }>('/v1/login', c.get('token'), {
      ...body,
      csrfToken: c.req.header('x-csrf-token'),
    });
    setCookie(c, cookie, result.token, cookieOptions);
    return c.json({
      ...(await client.request<SessionView>('/v1/session', result.token)),
      modelMode: options.mode,
    });
  });
  app.post('/api/logout', async (c) => {
    await client.request('/v1/logout', c.get('token'), { csrfToken: c.req.header('x-csrf-token') });
    deleteCookie(c, cookie, { path: '/' });
    return c.json({ loggedOut: true });
  });
  app.get('/api/workspaces', (c) => c.json({ workspaces: c.get('session').workspaces }));

  const base = '/api/workspaces/:workspace';
  app.use(base + '/*', async (c, next) => {
    uuid.parse(c.req.param('workspace'));
    await next();
  });
  const path = (workspace: unknown) => '/v1/workspaces/' + uuid.parse(workspace);
  app.get(base + '/documents', async (c) =>
    c.json(await client.request(path(c.req.param('workspace')) + '/documents', c.get('token'))),
  );
  app.post(base + '/documents', async (c) =>
    c.json(
      await client.request(
        path(c.req.param('workspace')) + '/documents',
        c.get('token'),
        documentInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.patch(base + '/documents/:document/acl', async (c) =>
    c.json(
      await client.request(
        path(c.req.param('workspace')) +
          '/documents/' +
          uuid.parse(c.req.param('document')) +
          '/acl',
        c.get('token'),
        aclInput.parse(await c.req.json()),
        'PATCH',
      ),
    ),
  );
  app.delete(base + '/documents/:document', async (c) => {
    await client.request(
      path(c.req.param('workspace')) + '/documents/' + uuid.parse(c.req.param('document')),
      c.get('token'),
      undefined,
      'DELETE',
    );
    return c.body(null, 204);
  });
  app.get(base + '/sources/:document', async (c) => {
    const chunk = c.req.query('chunkId');
    return c.json(
      await client.request(
        path(c.req.param('workspace')) +
          '/sources/' +
          uuid.parse(c.req.param('document')) +
          (chunk ? '?chunkId=' + uuid.parse(chunk) : ''),
        c.get('token'),
      ),
    );
  });
  app.get(base + '/conversations', async (c) =>
    c.json(await client.request(path(c.req.param('workspace')) + '/conversations', c.get('token'))),
  );
  app.post(base + '/conversations', async (c) =>
    c.json(
      await client.request(
        path(c.req.param('workspace')) + '/conversations',
        c.get('token'),
        conversationInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.get(base + '/conversations/:conversation/messages', async (c) =>
    c.json(
      await client.request(
        path(c.req.param('workspace')) +
          '/conversations/' +
          uuid.parse(c.req.param('conversation')) +
          '/messages',
        c.get('token'),
      ),
    ),
  );
  app.get(base + '/activity', async (c) => {
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .parse(c.req.query('limit') ?? 20);
    return c.json(
      await client.request(
        path(c.req.param('workspace')) + '/activity?limit=' + limit,
        c.get('token'),
      ),
    );
  });
  const turnBase = base + '/conversations/:conversation/turns';
  app.post(turnBase, async (c) => {
    if (Number(c.req.header('content-length') ?? 0) > 16384)
      throw new DataError('BODY_TOO_LARGE', 413);
    const body = turnInput.parse(await c.req.json());
    const workspace = c.req.param('workspace');
    const conversation = uuid.parse(c.req.param('conversation'));
    const token = c.get('token');
    const actor = c.get('session').actor!.id;
    if (!rate.consume('chat:' + actor + ':' + workspace, 6))
      throw new DataError('RATE_LIMITED', 429);
    const release = admission.acquire(actor);
    let prefix = '';
    const controller = new AbortController();
    try {
      const prepared = await client.request<
        { isNew: boolean; turnId: string; history: HistoryMessage[] } & TurnReply
      >(path(workspace) + '/conversations/' + conversation + '/turns', token, body);
      if (!prepared.isNew) return c.json({ ...prepared, requestId: c.get('requestId') });
      prefix = path(workspace) + '/conversations/' + conversation + '/turns/' + prepared.turnId;
      active.set(prepared.turnId, controller);
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(30000),
        c.req.raw.signal,
      ]);
      const tools = scopedTools(client, token, prefix);
      const chunks = await tools.search({ query: body.question.slice(0, 500), limit: 4 });
      await client.request(prefix + '/check', token, {});
      const result = await options.runner.run({
        question: body.question,
        history: prepared.history,
        chunks,
        tools,
        signal,
        checkAccess: async () => {
          await client.request(prefix + '/check', token, {});
        },
      });
      if (signal.aborted) throw new Error('REQUEST_CANCELLED');
      let output;
      try {
        output = gateAnswer(result.output, tools.registry);
      } catch {
        throw new Error('UNVERIFIED_RESPONSE');
      }
      const reply = await client.request<TurnReply>(prefix + '/finalize', token, {
        output,
        model: result.model,
      });
      return c.json(
        {
          ...reply,
          ...(result.usage ? { usage: result.usage } : {}),
          requestId: c.get('requestId'),
        },
        reply.status === 'ACCESS_CHANGED' ? 409 : 200,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE';
      if (prefix) {
        const state =
          code === 'ACCESS_CHANGED'
            ? 'ACCESS_CHANGED'
            : code === 'BUDGET_EXHAUSTED'
              ? 'BUDGET_EXHAUSTED'
              : code === 'UNVERIFIED_RESPONSE'
                ? 'UNVERIFIED_RESPONSE'
                : controller.signal.aborted
                  ? 'CANCELLED'
                  : 'PROVIDER_ERROR';
        const terminal = await client
          .request<TurnReply>(prefix + '/fail', token, { status: state })
          .catch(() => undefined);
        if (controller.signal.aborted && terminal?.status === 'CANCELLED')
          return c.json({
            ...terminal,
            model: { mode: options.mode, id: null, version: null },
            requestId: c.get('requestId'),
          });
      }
      throw error;
    } finally {
      if (prefix) active.delete(prefix.split('/').at(-1)!);
      release();
    }
  });
  app.post(turnBase + '/:turn/cancel', async (c) => {
    const turn = uuid.parse(c.req.param('turn'));
    const reply = await client.request(
      path(c.req.param('workspace')) +
        '/conversations/' +
        uuid.parse(c.req.param('conversation')) +
        '/turns/' +
        turn +
        '/cancel',
      c.get('token'),
      {},
    );
    active.get(turn)?.abort();
    return c.json(reply);
  });
  app.notFound((c) => c.json({ code: 'NOT_FOUND', detail: 'This route is not available.' }, 404));
  return app;
}

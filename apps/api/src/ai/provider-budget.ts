import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readSourceInput, searchInput } from '@cleardesk/contracts';

export const GOOGLE_MODEL = 'gemini-3.5-flash-lite';
const PROVIDER_ERRORS = [
  'INVALID_ARGUMENT',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'NOT_FOUND',
  'INTERNAL',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
] as const;
export interface ProviderObservation {
  httpStatus: number;
  modelVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerErrorCode: (typeof PROVIDER_ERRORS)[number] | null;
}
interface BudgetState {
  version: 1;
  limit: number | null;
  attempts: { id: string; reservedAt: string }[];
}

/** Durable pre-dispatch accounting. An explicit null cap tracks application use without a quota. */
export class ProviderBudget {
  constructor(
    private readonly path: string,
    private readonly limit: number | null = 12,
  ) {
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 12))
      throw new Error('BUDGET_STATE_INVALID');
  }

  private read(): BudgetState {
    if (!existsSync(this.path)) return { version: 1, limit: this.limit, attempts: [] };
    try {
      const state = JSON.parse(readFileSync(this.path, 'utf8')) as BudgetState;
      if (
        state.version !== 1 ||
        state.limit !== this.limit ||
        !Array.isArray(state.attempts) ||
        (state.limit !== null && state.attempts.length > state.limit) ||
        state.attempts.some((a) => typeof a.id !== 'string' || typeof a.reservedAt !== 'string') ||
        new Set(state.attempts.map((a) => a.id)).size !== state.attempts.length
      )
        throw new Error();
      return state;
    } catch {
      throw new Error('BUDGET_STATE_INVALID');
    }
  }

  snapshot(): { spent: number; limit: number | null; remaining: number | null } {
    const state = this.read();
    return {
      spent: state.attempts.length,
      limit: state.limit,
      remaining: state.limit === null ? null : state.limit - state.attempts.length,
    };
  }

  reserve(): string {
    mkdirSync(dirname(this.path), { recursive: true });
    const lock = this.path + '.lock';
    try {
      mkdirSync(lock);
    } catch {
      throw new Error('BUDGET_LOCKED');
    }
    try {
      const state = this.read();
      if (state.limit !== null && state.attempts.length >= state.limit)
        throw new Error('BUDGET_EXHAUSTED');
      const id = randomUUID();
      state.attempts.push({ id, reservedAt: new Date().toISOString() });
      const temporary = this.path + '.' + id + '.tmp';
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(state, null, 2) + '\n');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.path);
      return id;
    } finally {
      rmdirSync(lock);
    }
  }
}

/** Preserve the original verification ledger and carry its history into count-only application use. */
export function applicationUsage(path: string, legacyPath: string): ProviderBudget {
  if (!existsSync(path) && existsSync(legacyPath)) {
    new ProviderBudget(legacyPath, 12).snapshot();
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as BudgetState;
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ ...legacy, limit: null }, null, 2) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  const usage = new ProviderBudget(path, null);
  usage.snapshot(); // Existing corruption fails closed; no history is silently reset.
  return usage;
}

/** The SDK cannot redirect credentials or bypass accounting through retries/framework subcalls. */
export function createBudgetedFetch(
  budget: ProviderBudget,
  upstream: typeof fetch = fetch,
  observe?: (value: ProviderObservation) => void,
  beforeDispatch?: () => Promise<void>,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const path = `/v1beta/models/${GOOGLE_MODEL}:`;
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'generativelanguage.googleapis.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      url.search !== '' ||
      url.pathname !== path + 'generateContent' ||
      init?.method !== 'POST' ||
      typeof init.body !== 'string' ||
      Buffer.byteLength(init.body) > 65536
    )
      throw new Error('PROVIDER_REQUEST_REJECTED');
    let parsed: { generationConfig?: { maxOutputTokens?: number }; tools?: unknown };
    try {
      parsed = JSON.parse(init.body);
    } catch {
      throw new Error('PROVIDER_REQUEST_REJECTED');
    }
    const maximum = parsed.generationConfig?.maxOutputTokens;
    if (!Number.isInteger(maximum) || !maximum || maximum > 512 || maximum < 1)
      throw new Error('PROVIDER_REQUEST_REJECTED');
    const allowedTools = ['searchKnowledge', 'readSource'];
    if (parsed.tools !== undefined) {
      if (!Array.isArray(parsed.tools) || parsed.tools.length > 2)
        throw new Error('PROVIDER_REQUEST_REJECTED');
      const names: string[] = [];
      for (const tool of parsed.tools) {
        if (
          !tool ||
          Object.keys(tool).some((key) => key !== 'functionDeclarations') ||
          !Array.isArray(tool.functionDeclarations)
        )
          throw new Error('PROVIDER_REQUEST_REJECTED');
        for (const declaration of tool.functionDeclarations) {
          if (!allowedTools.includes(declaration?.name))
            throw new Error('PROVIDER_REQUEST_REJECTED');
          names.push(declaration.name);
        }
      }
      if (names.length > 2 || new Set(names).size !== names.length)
        throw new Error('PROVIDER_REQUEST_REJECTED');
    }
    if (init.signal?.aborted) throw new Error('REQUEST_CANCELLED');
    await beforeDispatch?.();
    if (init.signal?.aborted) throw new Error('REQUEST_CANCELLED');
    budget.reserve();
    const response = await upstream(url.href, { ...init, redirect: 'error' });
    // Buffer only bounded provider output; no unvalidated token is streamed to the user.
    const reader = response.body?.getReader();
    const pieces: Uint8Array[] = [];
    let total = 0;
    if (reader)
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > 262144) {
          await reader.cancel();
          throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
        }
        pieces.push(part.value);
      }
    const bytes = Buffer.concat(pieces);
    let metadata: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value))
        metadata = value as Record<string, unknown>;
    } catch {
      /* The SDK validates the actual body. */
    }
    const usage = metadata.usageMetadata as Record<string, unknown> | undefined;
    const providerError = (metadata.error as { status?: unknown } | undefined)?.status;
    const count = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    observe?.({
      httpStatus: response.status,
      modelVersion:
        typeof metadata.modelVersion === 'string' &&
        /^[a-zA-Z0-9_.-]{1,150}$/.test(metadata.modelVersion)
          ? metadata.modelVersion
          : null,
      inputTokens: count(usage?.promptTokenCount),
      outputTokens: count(usage?.candidatesTokenCount),
      providerErrorCode: PROVIDER_ERRORS.find((code) => code === providerError) ?? null,
    });
    // Enforce the closed tool namespace before untrusted calls reach framework dispatch.
    if (Array.isArray(metadata.candidates))
      for (const candidate of metadata.candidates) {
        if (!Array.isArray(candidate?.content?.parts)) continue;
        for (const part of candidate.content.parts) {
          if (!part?.functionCall) continue;
          const call = part.functionCall;
          if (call.name === 'searchKnowledge') {
            if (!searchInput.safeParse(call.args).success) throw new Error('UNVERIFIED_RESPONSE');
          } else if (call.name === 'readSource') {
            if (!readSourceInput.safeParse(call.args).success)
              throw new Error('UNVERIFIED_RESPONSE');
          } else throw new Error('UNVERIFIED_RESPONSE');
        }
      }
    return new Response(bytes, { status: response.status, headers: response.headers });
  };
}

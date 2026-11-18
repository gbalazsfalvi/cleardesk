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

export const GOOGLE_MODEL = 'gemini-3.5-flash-lite';
export interface ProviderObservation {
  httpStatus: number;
  modelVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}
interface BudgetState {
  version: 1;
  limit: number;
  attempts: { id: string; reservedAt: string }[];
}

/** A durable pre-dispatch counter: failed, retried and uncertain requests remain spent. */
export class ProviderBudget {
  constructor(
    private readonly path: string,
    private readonly limit = 12,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 12)
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
        state.attempts.length > state.limit ||
        state.attempts.some((a) => typeof a.id !== 'string' || typeof a.reservedAt !== 'string') ||
        new Set(state.attempts.map((a) => a.id)).size !== state.attempts.length
      )
        throw new Error();
      return state;
    } catch {
      throw new Error('BUDGET_STATE_INVALID');
    }
  }

  snapshot(): { spent: number; limit: number; remaining: number } {
    const state = this.read();
    return {
      spent: state.attempts.length,
      limit: state.limit,
      remaining: state.limit - state.attempts.length,
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
      if (state.attempts.length >= state.limit) throw new Error('BUDGET_EXHAUSTED');
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

/** The SDK cannot redirect credentials or bypass accounting through retries/framework subcalls. */
export function createBudgetedFetch(
  budget: ProviderBudget,
  upstream: typeof fetch = fetch,
  observe?: (value: ProviderObservation) => void,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const path = `/v1beta/models/${GOOGLE_MODEL}:`;
    const queryAllowed = [...url.searchParams].every(
      ([key, value]) => key === 'alt' && value === 'sse',
    );
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'generativelanguage.googleapis.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !queryAllowed ||
      !['generateContent', 'streamGenerateContent'].some(
        (method) => url.pathname === path + method,
      ) ||
      init?.method !== 'POST' ||
      typeof init.body !== 'string' ||
      Buffer.byteLength(init.body) > 65536
    )
      throw new Error('PROVIDER_REQUEST_REJECTED');
    let parsed: { generationConfig?: { maxOutputTokens?: number } };
    try {
      parsed = JSON.parse(init.body);
    } catch {
      throw new Error('PROVIDER_REQUEST_REJECTED');
    }
    const maximum = parsed.generationConfig?.maxOutputTokens;
    if (!Number.isInteger(maximum) || !maximum || maximum > 512 || maximum < 1)
      throw new Error('PROVIDER_REQUEST_REJECTED');
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
    if (response.ok && !url.pathname.endsWith(':streamGenerateContent')) {
      try {
        metadata = JSON.parse(bytes.toString('utf8'));
      } catch {
        /* The SDK validates the actual body. */
      }
    }
    const usage = metadata.usageMetadata as Record<string, unknown> | undefined;
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
    });
    return new Response(bytes, { status: response.status, headers: response.headers });
  };
}

/** Only this adapter knows the private service credential; never forward browser headers. */
export class DataError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export class KnowledgeClient {
  constructor(
    private readonly origin: string,
    private readonly serviceKey: string,
  ) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('PRIVATE_ORIGIN_INVALID');
  }

  async request<T>(path: string, token?: string, body?: unknown, method?: string): Promise<T> {
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('#'))
      throw new Error('PRIVATE_PATH_INVALID');
    const headers: Record<string, string> = { 'x-cleardesk-service': this.serviceKey };
    if (token) headers['x-cleardesk-session'] = token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(this.origin + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!response.ok) {
      const value = (await response.json().catch(() => ({}))) as { code?: unknown };
      const code =
        typeof value.code === 'string' && /^[A-Z_]{1,40}$/.test(value.code)
          ? value.code
          : 'DATA_UNAVAILABLE';
      throw new DataError(code, response.status);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}

import type { ApiProblem } from '@cleardesk/contracts';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The browser holds only a synchronizer CSRF value; the session stays in an HttpOnly cookie. */
export async function request<T>(
  path: string,
  csrf: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Invalid application path');
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body === undefined && method !== 'DELETE'
        ? {}
        : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Partial<ApiProblem>;
    throw new ApiError(
      problem.code ?? 'UNAVAILABLE',
      problem.detail ?? 'The request could not be completed.',
      response.status,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

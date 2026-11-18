import { afterEach, expect, it, vi } from 'vitest';
import { request } from '../src/api.js';

afterEach(() => vi.unstubAllGlobals());
it('explains a revision-conflict turn reply instead of displaying an unexplained failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ACCESS_CHANGED', answer: null, sources: [] }), {
        status: 409,
      }),
    ),
  );
  await expect(
    request('/api/workspaces/example/conversations/example/turns', 'csrf', {}),
  ).rejects.toThrow('Knowledge access changed');
});

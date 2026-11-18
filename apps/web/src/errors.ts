/** A stale authorized response is ignored when the selected UI workspace has changed. */

export class ScopeChanged extends Error {}
export const describeError = (error: unknown) =>
  error instanceof ScopeChanged
    ? ''
    : error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.';

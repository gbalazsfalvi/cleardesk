/** Formats an English count with the correct singular or plural noun phrase. */
export function countLabel(count: number, singular: string, plural = singular + 's'): string {
  return count + ' ' + (count === 1 ? singular : plural);
}

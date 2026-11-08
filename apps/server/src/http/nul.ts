/**
 * Whether a request value holds U+0000 anywhere, keys included. PostgreSQL text cannot store it:
 * left through, every route that saves text answers 500 instead of 400.
 */
export function containsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\0');
  if (Array.isArray(value)) return value.some(containsNul);
  if (value !== null && typeof value === 'object')
    return Object.entries(value).some(([key, v]) => key.includes('\0') || containsNul(v));
  return false;
}

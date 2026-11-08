/**
 * Whether a parsed request value holds U+0000 anywhere, keys included. PostgreSQL text cannot
 * store it: left through, every route that saves text answers 500 instead of 400. Only what JSON
 * and query strings parse to is walked: a stream or a Buffer from another content parser is not
 * text, and walking its internals would recurse without end.
 */
export function containsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\0');
  if (Array.isArray(value)) return value.some(containsNul);
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.entries(value).some(([key, v]) => key.includes('\0') || containsNul(v));
}

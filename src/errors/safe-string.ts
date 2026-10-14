/**
 * @internal `String(value)` that never throws. Values `String` rejects (an object without a
 * prototype, a throwing `toString` / `Symbol.toPrimitive`) fall back to
 * `Object.prototype.toString` (`[object Object]`), then to `'[unserializable]'`.
 */
export function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    try {
      return Object.prototype.toString.call(value);
    } catch {
      return '[unserializable]';
    }
  }
}

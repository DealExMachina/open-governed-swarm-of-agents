/**
 * Safe error serialization to avoid logging huge objects (e.g. pg Client, sockets).
 * Plain objects without `message` / `code` use JSON.stringify (truncated) instead of "[object Object]".
 */

export function toErrorString(e: unknown): string {
  if (e === null) return "null";
  if (e === undefined) return "undefined";
  if (e instanceof Error) {
    const code =
      "code" in e ? String((e as Error & { code?: string }).code) : "";
    return e.message + (code ? ` [${code}]` : "");
  }
  if (typeof e === "object" && e !== null) {
    const o = e as Record<string, unknown>;
    const msg = o.message;
    const code = o.code;
    if (typeof msg === "string")
      return typeof code === "string" ? `${msg} [${code}]` : msg;
    if (typeof code === "string") return code;
    try {
      const s = JSON.stringify(e);
      const max = 2000;
      return s.length > max ? `${s.slice(0, max)}…` : s;
    } catch {
      return "[unserializable object]";
    }
  }
  try {
    return String(e);
  } catch {
    return typeof e === "object" && e !== null
      ? Object.prototype.toString.call(e)
      : "[unknown]";
  }
}

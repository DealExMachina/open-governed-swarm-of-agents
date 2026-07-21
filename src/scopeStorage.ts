/**
 * Scope-partitioned S3 keys for agent artifacts (facts, drift, resolutions, deltas).
 * Prevents cross-scope leakage when Studio or demo switches catalog scopes.
 */
import { getActiveScopeId } from "./billingContext.js";

/** Safe scope id segment for S3 prefixes. */
export function sanitizeScopeIdForStorage(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Prefix for all persisted artifacts belonging to one scope. */
export function scopeStoragePrefix(scopeId: string): string {
  return `scopes/${sanitizeScopeIdForStorage(scopeId)}`;
}

/** Join a relative artifact path under the scope prefix (e.g. facts/latest.json). */
export function scopeStorageKey(scopeId: string, relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, "");
  return `${scopeStoragePrefix(scopeId)}/${rel}`;
}

export function scopeFactsKey(scopeId: string): string {
  return scopeStorageKey(scopeId, "facts/latest.json");
}

export function scopeDriftKey(scopeId: string): string {
  return scopeStorageKey(scopeId, "drift/latest.json");
}

export function scopeResolutionsKey(scopeId: string): string {
  return scopeStorageKey(scopeId, "resolutions/latest.json");
}

export function scopeDeltasKey(scopeId: string): string {
  return scopeStorageKey(scopeId, "deltas/latest.json");
}

export function scopeFactsHistoryPrefix(scopeId: string): string {
  return scopeStorageKey(scopeId, "facts/history/");
}

export function scopeDriftHistoryPrefix(scopeId: string): string {
  return scopeStorageKey(scopeId, "drift/history/");
}

export function scopeFactsHistoryKey(scopeId: string, ts: string): string {
  return scopeStorageKey(
    scopeId,
    `facts/history/${ts.replace(/[:.]/g, "-")}.json`,
  );
}

export function scopeDriftHistoryKey(scopeId: string, ts: string): string {
  return scopeStorageKey(
    scopeId,
    `drift/history/${ts.replace(/[:.]/g, "-")}.json`,
  );
}

/** Resolve scope for S3 reads/writes: explicit > active billing context > env > default. */
export function resolveStorageScopeId(explicit?: string | null): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return getActiveScopeId() || process.env.SCOPE_ID || "default";
}

/**
 * Map filter/config relative fields (facts/latest.json) to scoped keys.
 * Already-scoped keys (scopes/…, tenants/…) are returned unchanged.
 */
export function resolveScopedFieldKey(scopeId: string, field: string): string {
  if (field.startsWith("scopes/") || field.startsWith("tenants/")) {
    return field;
  }
  return scopeStorageKey(scopeId, field);
}

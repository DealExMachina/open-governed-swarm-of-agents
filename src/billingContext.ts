/**
 * Active tenant + scope for billing (usage_events) and swarm event envelopes.
 * Updated by hatchery/control plane when processing scope changes.
 */
let _scopeId = process.env.SCOPE_ID ?? "default";
let _tenantId: string | null = process.env.ACTIVE_TENANT_ID ?? null;

export function setActiveBillingContext(tenantId: string | null, scopeId: string): void {
  _tenantId = tenantId;
  _scopeId = scopeId;
  process.env.SCOPE_ID = scopeId;
  if (tenantId) process.env.ACTIVE_TENANT_ID = tenantId;
  else delete process.env.ACTIVE_TENANT_ID;
}

export function getActiveScopeId(): string {
  return _scopeId;
}

export function getActiveTenantId(): string | null {
  return _tenantId;
}

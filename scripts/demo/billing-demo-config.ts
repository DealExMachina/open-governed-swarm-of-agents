/**
 * Shared configuration for the delta billing demo (2 tenants x 5 scopes).
 *
 * Meridian Capital: large prepaid plan, driven at normal volume -> stays within budget.
 * Orion Advisory: deliberately small plan, driven hard -> deep overage ("exploding subscription").
 */

export interface BillingTenantConfig {
  /** Tenant display name (unique key used for idempotent seeding). */
  name: string;
  planName: string;
  prepaidTokens: number;
  overageRateCents: number;
  /** Scope id prefix; scope ids are `bill_<slug>_1..N`. */
  slug: string;
  scopeCount: number;
  /** Documents driven per scope in real mode (drives how many cycles run). */
  docsPerScope: number;
  /**
   * Billable deltas minted per scope in synthetic mode. Chosen so Meridian
   * stays within its 1000-token plan and Orion (150) blows deep into overage.
   */
  syntheticDeltasPerScope: number;
}

export const BILLING_TENANTS: BillingTenantConfig[] = [
  {
    name: "Meridian Capital",
    planName: "Growth",
    prepaidTokens: 1000,
    overageRateCents: 5,
    slug: "meridian",
    scopeCount: 5,
    docsPerScope: 1,
    syntheticDeltasPerScope: 40,
  },
  {
    name: "Orion Advisory",
    planName: "Starter",
    prepaidTokens: 150,
    overageRateCents: 10,
    slug: "orion",
    scopeCount: 5,
    docsPerScope: 3,
    syntheticDeltasPerScope: 60,
  },
];

/** Deterministic scope ids for a tenant (bill_<slug>_1 .. bill_<slug>_N). */
export function scopeIdsForTenant(t: BillingTenantConfig): string[] {
  return Array.from(
    { length: t.scopeCount },
    (_, i) => `bill_${t.slug}_${i + 1}`,
  );
}

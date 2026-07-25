/**
 * Metering provider abstraction.
 *
 * Deltas are the billable currency. The delta ledger records net-new billable
 * deltas, then hands each one to a metering provider which applies the tenant's
 * plan (prepaid burn-down, then overage). This interface is shaped to mirror a
 * usage-based billing platform (Metronome-style ingest + customer balances) so
 * a real `metronomeProvider` can drop in later without touching the ledger.
 *
 * Selection is via env `METERING_PROVIDER` (default `local`).
 */
import type pg from "pg";

/** A billable delta handed to the metering provider. */
export interface DeltaEventForMetering {
  /** delta_events.id — used as the idempotency key for ingest. */
  id: number;
  tenantId: string | null;
  scopeId: string;
  /** Billable tokens for this delta (currently = weight, default 1). */
  tokens: number;
  /** ISO timestamp the delta was recorded (t_time). */
  timestamp: string;
  channel: string;
}

/** Current plan balance for a tenant. */
export interface TenantBalance {
  tenantId: string;
  planName: string;
  prepaidTokens: number;
  /** Prepaid tokens consumed so far this period. */
  consumedTokens: number;
  /** Prepaid tokens remaining (>= 0). */
  remainingTokens: number;
  overageTokens: number;
  overageCents: number;
}

export interface OverageSummary {
  overageTokens: number;
  overageCents: number;
}

export interface UsageSummary {
  billableDeltas: number;
}

export interface MeteringProvider {
  readonly name: string;
  /** Apply plan rules to one billable delta. Must be idempotent per delta id. */
  ingestDeltaEvent(evt: DeltaEventForMetering, pool?: pg.Pool): Promise<void>;
  getBalance(tenantId: string, pool?: pg.Pool): Promise<TenantBalance | null>;
  getOverage(tenantId: string, pool?: pg.Pool): Promise<OverageSummary>;
  getUsage(
    tenantId: string,
    scopeId?: string,
    pool?: pg.Pool,
  ): Promise<UsageSummary>;
}

let _provider: MeteringProvider | null = null;

/**
 * Resolve the active metering provider. `local` is the self-contained simulator
 * used by the demo; other values are reserved for a future real provider.
 */
export function getMeteringProvider(): MeteringProvider {
  if (_provider) return _provider;
  const kind = (process.env.METERING_PROVIDER ?? "local").toLowerCase();
  switch (kind) {
    case "local":
    case "":
      // Lazy import to avoid a cycle (localMeteringProvider imports this module).
      _provider = new LocalProviderProxy();
      return _provider;
    default:
      throw new Error(
        `METERING_PROVIDER="${kind}" is not implemented in this demo (only "local"). ` +
          `A real Metronome/Stripe provider is future work.`,
      );
  }
}

/** Test/override hook. */
export function _setMeteringProvider(p: MeteringProvider | null): void {
  _provider = p;
}

/**
 * Thin proxy that defers loading the local implementation until first use,
 * keeping the interface module free of a hard dependency on the impl.
 */
class LocalProviderProxy implements MeteringProvider {
  readonly name = "local";
  private impl: MeteringProvider | null = null;

  private async load(): Promise<MeteringProvider> {
    if (!this.impl) {
      const mod = await import("./localMeteringProvider.js");
      this.impl = new mod.LocalMeteringProvider();
    }
    return this.impl;
  }

  async ingestDeltaEvent(
    evt: DeltaEventForMetering,
    pool?: pg.Pool,
  ): Promise<void> {
    return (await this.load()).ingestDeltaEvent(evt, pool);
  }
  async getBalance(
    tenantId: string,
    pool?: pg.Pool,
  ): Promise<TenantBalance | null> {
    return (await this.load()).getBalance(tenantId, pool);
  }
  async getOverage(tenantId: string, pool?: pg.Pool): Promise<OverageSummary> {
    return (await this.load()).getOverage(tenantId, pool);
  }
  async getUsage(
    tenantId: string,
    scopeId?: string,
    pool?: pg.Pool,
  ): Promise<UsageSummary> {
    return (await this.load()).getUsage(tenantId, scopeId, pool);
  }
}

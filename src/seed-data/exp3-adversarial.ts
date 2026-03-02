/**
 * Exp 3 seed data: adversarial evidence patterns for finality robustness.
 * Used by scripts/seed-exp3-adversarial.ts.
 *
 * Patterns: spike-and-drop, oscillating, stale, empty
 */
export const EXP3_CREATED_BY = "seed-exp3";

export type Exp3Pattern = "spike-and-drop" | "oscillating" | "stale" | "empty";

export interface SpikeAndDropSeed {
  pattern: "spike-and-drop";
  claims: Array<{ content: string; confidence: number }>;
  contradictions: Array<{ sourceIndex: number; targetIndex: number; raw: string }>;
}

export interface OscillatingSeed {
  pattern: "oscillating";
  claims: string[];
  contradictions: Array<{ sourceIndex: number; targetIndex: number; raw: string }>;
}

export interface StaleSeed {
  pattern: "stale";
  claims: Array<{ content: string; validFrom: string; validTo: string }>;
}

export interface EmptySeed {
  pattern: "empty";
}

export type Exp3SeedData = SpikeAndDropSeed | OscillatingSeed | StaleSeed | EmptySeed;

export function makeExp3Seed(pattern: Exp3Pattern): Exp3SeedData {
  switch (pattern) {
    case "spike-and-drop":
      return {
        pattern: "spike-and-drop",
        claims: [
          { content: "Exp3 spike: Revenue target met at 120%", confidence: 0.95 },
          { content: "Exp3 spike: All milestones delivered on time", confidence: 0.95 },
          { content: "Exp3 drop: Budget overrun reported", confidence: 0.95 },
          { content: "Exp3 drop: Timeline slipped by 2 quarters", confidence: 0.95 },
        ],
        contradictions: [
          { sourceIndex: 0, targetIndex: 2, raw: "Revenue met vs budget overrun" },
          { sourceIndex: 1, targetIndex: 3, raw: "On time vs timeline slipped" },
        ],
      };
    case "oscillating":
      return {
        pattern: "oscillating",
        claims: [
          "Exp3 osc A: Market is bullish",
          "Exp3 osc B: Market is bearish",
          "Exp3 osc C: Growth is accelerating",
          "Exp3 osc D: Growth is decelerating",
        ],
        contradictions: [
          { sourceIndex: 0, targetIndex: 1, raw: "Bullish vs bearish" },
          { sourceIndex: 2, targetIndex: 3, raw: "Accelerating vs decelerating" },
        ],
      };
    case "stale": {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 400);
      const to = new Date(now);
      to.setDate(to.getDate() - 350);
      return {
        pattern: "stale",
        claims: [
          {
            content: "Exp3 stale: Audit report from 400 days ago",
            validFrom: from.toISOString(),
            validTo: to.toISOString(),
          },
        ],
      };
    }
    case "empty":
      return { pattern: "empty" };
    default:
      throw new Error(`Unknown pattern: ${pattern}`);
  }
}

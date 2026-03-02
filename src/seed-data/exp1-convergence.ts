/**
 * Exp 1 seed data: controlled contradiction injection for convergence dynamics.
 * Used by scripts/seed-exp1.ts.
 *
 * For c ∈ {0,1,3,5} contradictions, we create 2*c claims (or 2 extra for c=0)
 * and c unresolved contradiction edges.
 */
export const EXP1_CREATED_BY = "seed-exp1";

/** Generate claim texts for a given contradiction count. */
export function makeExp1Claims(contradictionCount: number): string[] {
  const n = Math.max(2, contradictionCount * 2);
  return Array.from({ length: n }, (_, i) => `Exp1 claim ${i + 1}: baseline assertion for cycle ${contradictionCount}C`);
}

/** Generate contradiction edges: each pair (2i, 2i+1) forms one contradiction. */
export function makeExp1ContradictionEdges(contradictionCount: number): Array<{ sourceIndex: number; targetIndex: number; raw: string }> {
  const edges: Array<{ sourceIndex: number; targetIndex: number; raw: string }> = [];
  for (let i = 0; i < contradictionCount; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    edges.push({
      sourceIndex: a,
      targetIndex: b,
      raw: `Exp1 contradiction ${i + 1}: claim ${a + 1} vs claim ${b + 1}`,
    });
  }
  return edges;
}

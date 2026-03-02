/**
 * Exp 2 seed data: synthetic graph for scalability experiments.
 * Used by scripts/seed-exp2-graph.ts.
 *
 * Vary |N| (claim count) and rho (contradiction rate 0.1, 0.3, 0.5).
 * Contradiction count = floor(rho * N); pairs use claims (0,1), (2,3), ...
 */
export const EXP2_CREATED_BY = "seed-exp2";

export function makeExp2Claims(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Exp2 claim ${i + 1}/${n}: scalability baseline`);
}

export function makeExp2ContradictionEdges(n: number, rho: number): Array<{ sourceIndex: number; targetIndex: number; raw: string }> {
  const c = Math.floor(rho * n);
  const edges: Array<{ sourceIndex: number; targetIndex: number; raw: string }> = [];
  for (let i = 0; i < c && 2 * i + 1 < n; i++) {
    edges.push({
      sourceIndex: 2 * i,
      targetIndex: 2 * i + 1,
      raw: `Exp2 contradiction ${i + 1}/${c}: claim ${2 * i + 1} vs ${2 * i + 2}`,
    });
  }
  return edges;
}

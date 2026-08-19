import { getPool } from "../db.js";
import {
  synthesizeStudioEdges,
  type StudioLinkNode,
} from "../studioGraphEdges.js";
import { CURRENT_VIEW_EDGES, CURRENT_VIEW_NODES } from "./view.js";

function truncateStudioLabel(content: string, max = 48): string {
  const line = content.replace(/\s+/g, " ").trim();
  if (!line) return "—";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Cytoscape elements for SGRS Studio (`GET /studio/elements`). */
export async function getStudioGraphElements(scopeId: string): Promise<{
  nodes: Array<{ data: Record<string, unknown> }>;
  edges: Array<{ data: Record<string, unknown> }>;
}> {
  const p = getPool();
  const nodeRes = await p.query(
    `SELECT node_id, type, content, status, confidence, metadata, source_ref, created_by
     FROM nodes WHERE scope_id = $1 AND (${CURRENT_VIEW_NODES})
     ORDER BY type, created_at ASC`,
    [scopeId],
  );
  const edgeRes = await p.query(
    `SELECT source_id, target_id, edge_type
     FROM edges WHERE scope_id = $1 AND (${CURRENT_VIEW_EDGES})`,
    [scopeId],
  );

  const nodes = nodeRes.rows.map(
    (r: {
      node_id: string;
      type: string;
      content: string;
      status: string;
      confidence: number | null;
      metadata: Record<string, unknown> | null;
      source_ref: Record<string, unknown> | null;
      created_by: string | null;
    }) => {
      const type = String(r.type);
      const meta = r.metadata ?? {};
      const src = r.source_ref ?? {};
      const data: Record<string, unknown> = {
        id: String(r.node_id),
        label: truncateStudioLabel(String(r.content || type)),
        type,
        info: {
          subtitle: `${type} · ${r.status ?? "active"}`,
          desc: String(r.content || "").slice(0, 500),
        },
      };
      if (type === "claim" && r.confidence != null) {
        data.conf = Number(r.confidence);
      }
      if (type === "contradiction") {
        data.resolved = r.status === "resolved";
        data.veto =
          meta.veto === true ||
          meta.blocks_finality === true ||
          src.blocks_finality === true;
      }
      if (type === "resolution" || r.created_by === "resolution") {
        data.type = "resolution";
        const targets = src.targetsContradiction ?? src.contradiction_id;
        if (targets) data.targetsContradiction = String(targets);
      }
      return { data };
    },
  );

  const studioEdgeId = (source: string, target: string, type: string): string =>
    `edge-${source}-${target}-${type}`;

  const edges = edgeRes.rows.map(
    (r: { source_id: string; target_id: string; edge_type: string }) => {
      const source = String(r.source_id);
      const target = String(r.target_id);
      const type = String(r.edge_type || "refers");
      return {
        data: {
          id: studioEdgeId(source, target, type),
          source,
          target,
          type,
        },
      };
    },
  );

  const edgeKeys = new Set(
    edges.map((e) => `${e.data.source}|${e.data.target}|${e.data.type}`),
  );
  const pushEdge = (source: string, target: string, type: string): void => {
    const key = `${source}|${target}|${type}`;
    if (!source || !target || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      data: {
        id: studioEdgeId(source, target, type),
        source,
        target,
        type,
      },
    });
  };

  // Synthetic edges when DB edges table is sparse (Studio business graph).
  const linkNodes: StudioLinkNode[] = nodeRes.rows.map(
    (r: {
      node_id: string;
      type: string;
      content: string;
      metadata: Record<string, unknown> | null;
      source_ref: Record<string, unknown> | null;
    }) => ({
      id: String(r.node_id),
      type: String(r.type),
      content: String(r.content || ""),
      metadata: r.metadata ?? {},
      source_ref: r.source_ref ?? {},
    }),
  );
  const synthesized = synthesizeStudioEdges(
    linkNodes,
    edges.map((e) => ({
      source: String(e.data.source),
      target: String(e.data.target),
      type: String(e.data.type),
    })),
  );
  for (const e of synthesized) {
    pushEdge(e.source, e.target, e.type);
  }

  return { nodes, edges };
}

export interface SemanticNode {
  node_id: string;
  scope_id: string;
  type: string;
  content: string;
  confidence: number;
  status: string;
  source_ref: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

export interface SemanticEdge {
  edge_id: string;
  scope_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}

export interface AppendNodeInput {
  scope_id: string;
  type: string;
  content: string;
  confidence?: number;
  status?: string;
  source_ref?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_by?: string;
  embedding?: number[] | null;
  /** Bitemporal: valid time interval (optional; null = atemporal). */
  valid_from?: string | null;
  valid_to?: string | null;
}

export interface AppendEdgeInput {
  scope_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
  created_by?: string;
  /** Bitemporal: valid time interval (optional; null = atemporal). */
  valid_from?: string | null;
  valid_to?: string | null;
}

export interface QueryNodesOptions {
  scope_id: string;
  type?: string;
  status?: string;
  limit?: number;
  /** Time-travel: as-of valid time (ISO). When set, only rows valid at this time. */
  asOfValidTime?: string;
  /** Time-travel: as-of transaction time (ISO). When set, only rows recorded and not superseded at this time. */
  asOfRecordedAt?: string;
}

export interface QueryEdgesOptions {
  scope_id: string;
  edge_type?: string;
  source_id?: string;
  target_id?: string;
  limit?: number;
  /** Time-travel: as-of valid time (ISO). */
  asOfValidTime?: string;
  /** Time-travel: as-of transaction time (ISO). */
  asOfRecordedAt?: string;
}

export interface UnresolvedContradictionDetail {
  node_id: string;
  content: string;
  side_a?: string;
  side_b?: string;
  related_claims?: string[];
}

export interface ContradictionWithResolution {
  node_id: string;
  content: string;
  status: string;
  side_a?: string;
  side_b?: string;
  resolution?: { by: string; reason: string; resolved_at: string };
}

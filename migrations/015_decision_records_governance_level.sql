-- Add governance level columns to decision_records for Exp 4 (multi-level governance).
-- governance_path: which tier produced the decision (processProposal, oversight_acceptDeterministic, etc.)
-- scope_id: scope at decision time
-- scope_mode: YOLO | MITL | MASTER at decision time

ALTER TABLE decision_records ADD COLUMN IF NOT EXISTS scope_id TEXT;
ALTER TABLE decision_records ADD COLUMN IF NOT EXISTS governance_path TEXT;
ALTER TABLE decision_records ADD COLUMN IF NOT EXISTS scope_mode TEXT;

CREATE INDEX IF NOT EXISTS idx_decision_records_scope ON decision_records (scope_id);
CREATE INDEX IF NOT EXISTS idx_decision_records_governance_path ON decision_records (governance_path);

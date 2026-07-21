-- Financial demo scenario catalog scope (aligned with src/scenarioScopes.ts).

INSERT INTO studio_catalog_scopes (id, name, tag, state, score, cycles) VALUES
  ('meridian-holdings', 'Meridian Holdings', 'financial', 'active', 0, 0)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  tag = EXCLUDED.tag,
  updated_at = now();

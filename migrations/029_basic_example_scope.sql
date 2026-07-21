-- Rename default scratch scope to Basic Example (see src/scenarioScopes.ts).

UPDATE studio_catalog_scopes
SET name = 'Basic Example', tag = 'example', updated_at = now()
WHERE id = 'default';

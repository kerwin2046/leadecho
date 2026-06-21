-- +goose Up
-- +goose StatementBegin

-- Promote monitoring_profiles into "agents": add lifecycle status, ownership,
-- and last-run telemetry so the /agents dashboard can render at-a-glance health.
ALTER TABLE monitoring_profiles
    ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS last_run_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_run_mentions INT,
    ADD COLUMN IF NOT EXISTS total_mentions    INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS deployed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deployed_at    TIMESTAMPTZ DEFAULT NOW();

-- Ensure is_active stays in sync with status for back-compat with existing
-- monitor queries that filter on is_active = true.
UPDATE monitoring_profiles SET is_active = (status = 'active') WHERE status IS NOT NULL;

-- Keywords belong to a single agent now, not floating at workspace scope.
ALTER TABLE keywords
    ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES monitoring_profiles(id) ON DELETE CASCADE;

-- Safety net: a workspace can have keywords but zero monitoring profiles (e.g.
-- keywords created before profiles existed). Those keywords would stay NULL
-- after the backfill below and break the NOT NULL constraint, so give every such
-- workspace a default agent first.
INSERT INTO monitoring_profiles (workspace_id, name, description, is_active, status)
SELECT DISTINCT k.workspace_id, 'Default Agent', 'Auto-created during migration', true, 'active'
FROM keywords k
WHERE k.profile_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM monitoring_profiles mp WHERE mp.workspace_id = k.workspace_id
  );

-- Backfill: every existing keyword with no profile gets attached to the first
-- (or only) monitoring profile in its workspace. Idempotent — re-running won't
-- detach already-assigned keywords.
UPDATE keywords k
SET profile_id = (
    SELECT id FROM monitoring_profiles
    WHERE workspace_id = k.workspace_id
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE k.profile_id IS NULL;

-- After backfill, enforce that every keyword has a profile.
-- (We can't easily add NOT NULL in one step without a default, so we do it
-- after the backfill above has populated every row.)
ALTER TABLE keywords
    ALTER COLUMN profile_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_keywords_profile ON keywords(profile_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_monitoring_profiles_status ON monitoring_profiles(workspace_id, status);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_monitoring_profiles_status;
DROP INDEX IF EXISTS idx_keywords_profile;
ALTER TABLE keywords ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE keywords DROP COLUMN IF EXISTS profile_id;
ALTER TABLE monitoring_profiles
    DROP COLUMN IF EXISTS deployed_at,
    DROP COLUMN IF EXISTS deployed_by,
    DROP COLUMN IF EXISTS total_mentions,
    DROP COLUMN IF EXISTS last_run_mentions,
    DROP COLUMN IF EXISTS last_run_at,
    DROP COLUMN IF EXISTS status;
-- +goose StatementEnd

-- +goose Up
-- +goose StatementBegin

-- Track whether the workspace has completed first-run admin setup.
-- Until this is set, /auth/setup is the only public endpoint that can create a user.
ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

-- Team invitations: admin invites a teammate by email, teammate accepts via token.
CREATE TABLE IF NOT EXISTS invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'viewer',
    token           TEXT UNIQUE NOT NULL,
    invited_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at     TIMESTAMPTZ,
    accepted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_workspace ON invitations(workspace_id, created_at DESC);
CREATE INDEX idx_invitations_token        ON invitations(token);
CREATE INDEX idx_invitations_email        ON invitations(workspace_id, email);

CREATE TRIGGER invitations_updated_at
    BEFORE UPDATE ON invitations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER IF EXISTS invitations_updated_at ON invitations;
DROP TABLE IF EXISTS invitations;
ALTER TABLE workspaces DROP COLUMN IF EXISTS setup_completed_at;
-- +goose StatementEnd

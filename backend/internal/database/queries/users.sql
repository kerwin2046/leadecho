-- name: ListUsersByExternalID :many
SELECT * FROM users
WHERE clerk_user_id = @clerk_user_id;

-- name: GetUser :one
SELECT * FROM users WHERE id = @id;

-- name: FindUserByEmail :one
SELECT * FROM users WHERE email = @email LIMIT 1;

-- name: CreateUser :one
INSERT INTO users (clerk_user_id, workspace_id, email, name, avatar_url, role, password_hash)
VALUES (@clerk_user_id, @workspace_id, @email, @name, @avatar_url, @role, @password_hash)
RETURNING *;

-- name: CountUsers :one
SELECT COUNT(*) FROM users;

-- name: ListUsersByWorkspace :many
SELECT * FROM users
WHERE workspace_id = @workspace_id
ORDER BY created_at ASC;

-- name: UpdateUserRole :one
UPDATE users
SET role = @role::user_role, updated_at = NOW()
WHERE id = @id AND workspace_id = @workspace_id
RETURNING *;

-- name: DeactivateUser :one
UPDATE users
SET is_active = false, updated_at = NOW()
WHERE id = @id AND workspace_id = @workspace_id
RETURNING *;

-- name: CompleteWorkspaceSetup :one
UPDATE workspaces
SET setup_completed_at = NOW(), updated_at = NOW()
WHERE id = @id
RETURNING *;

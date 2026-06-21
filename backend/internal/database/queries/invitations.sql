-- name: CreateInvitation :one
INSERT INTO invitations (workspace_id, email, role, token, invited_by, expires_at)
VALUES (@workspace_id, @email, @role::user_role, @token, @invited_by, @expires_at)
RETURNING *;

-- name: GetInvitationByToken :one
SELECT * FROM invitations WHERE token = @token;

-- name: ListInvitationsByWorkspace :many
SELECT * FROM invitations
WHERE workspace_id = @workspace_id
ORDER BY created_at DESC;

-- name: MarkInvitationAccepted :one
UPDATE invitations
SET accepted_at = NOW(),
    accepted_by = @accepted_by
WHERE id = @id
  AND accepted_at IS NULL
RETURNING *;

-- name: DeleteInvitation :exec
DELETE FROM invitations WHERE id = @id AND workspace_id = @workspace_id;

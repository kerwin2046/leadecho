-- name: ListMonitoringProfiles :many
SELECT * FROM monitoring_profiles
WHERE workspace_id = @workspace_id
ORDER BY created_at DESC;

-- name: ListActiveMonitoringProfiles :many
SELECT * FROM monitoring_profiles
WHERE workspace_id = @workspace_id AND is_active = true
ORDER BY created_at DESC;

-- name: GetMonitoringProfile :one
SELECT * FROM monitoring_profiles
WHERE id = @id AND workspace_id = @workspace_id;

-- name: CreateMonitoringProfile :one
INSERT INTO monitoring_profiles (workspace_id, name, description, is_active)
VALUES (@workspace_id, @name, @description, @is_active)
RETURNING *;

-- name: UpdateMonitoringProfile :one
UPDATE monitoring_profiles
SET name = @name, description = @description, is_active = @is_active
WHERE id = @id AND workspace_id = @workspace_id
RETURNING *;

-- name: DeleteMonitoringProfile :exec
DELETE FROM monitoring_profiles
WHERE id = @id AND workspace_id = @workspace_id;

-- name: ListAllActiveProfiles :many
SELECT * FROM monitoring_profiles
WHERE is_active = true
ORDER BY workspace_id, created_at DESC;

-- name: CountMonitoringProfiles :one
SELECT COUNT(*)::int as count FROM monitoring_profiles
WHERE workspace_id = @workspace_id;

-- ─── Pain-Point Embeddings ─────────────────────────────

-- name: CreatePainPointEmbedding :one
INSERT INTO pain_point_embeddings (profile_id, workspace_id, phrase, embedding)
VALUES (@profile_id, @workspace_id, @phrase, @embedding)
RETURNING *;

-- name: ListPainPointEmbeddings :many
SELECT * FROM pain_point_embeddings
WHERE profile_id = @profile_id
ORDER BY created_at;

-- name: ListPainPointEmbeddingsByWorkspace :many
SELECT * FROM pain_point_embeddings
WHERE workspace_id = @workspace_id
ORDER BY created_at;

-- name: DeletePainPointEmbeddingsByProfile :exec
DELETE FROM pain_point_embeddings
WHERE profile_id = @profile_id;

-- name: FindSimilarPainPoints :many
-- Only match pain points from ACTIVE monitoring profiles so deactivating a
-- profile actually stops its phrases from scoring new mentions.
SELECT ppe.id, ppe.profile_id, ppe.workspace_id, ppe.phrase,
    (1 - (ppe.embedding <=> @query_embedding::vector))::float8 as similarity
FROM pain_point_embeddings ppe
JOIN monitoring_profiles mp ON mp.id = ppe.profile_id
WHERE ppe.workspace_id = @workspace_id AND mp.is_active = true
ORDER BY ppe.embedding <=> @query_embedding::vector
LIMIT @lim;

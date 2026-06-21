-- name: ListMonitoringProfiles :many
SELECT * FROM monitoring_profiles
WHERE workspace_id = @workspace_id
ORDER BY created_at DESC;

-- name: ListAgents :many
-- Lists every agent (monitoring profile) for a workspace with roll-up stats:
-- keyword count, pain-point count, mention count, reply count. This drives
-- the /agents dashboard cards.
SELECT mp.id, mp.workspace_id, mp.name, mp.description, mp.is_active,
       mp.status, mp.last_run_at, mp.last_run_mentions, mp.total_mentions,
       mp.deployed_by, mp.deployed_at, mp.created_at, mp.updated_at,
       (SELECT COUNT(*)::int FROM keywords k WHERE k.profile_id = mp.id) AS keyword_count,
       (SELECT COUNT(*)::int FROM pain_point_embeddings ppe WHERE ppe.profile_id = mp.id) AS pain_point_count
FROM monitoring_profiles mp
WHERE mp.workspace_id = @workspace_id
ORDER BY mp.created_at DESC;

-- name: ListActiveMonitoringProfiles :many
SELECT * FROM monitoring_profiles
WHERE workspace_id = @workspace_id AND is_active = true
ORDER BY created_at DESC;

-- name: GetMonitoringProfile :one
SELECT * FROM monitoring_profiles
WHERE id = @id AND workspace_id = @workspace_id;

-- name: CreateMonitoringProfile :one
INSERT INTO monitoring_profiles (workspace_id, name, description, is_active, status, deployed_by)
VALUES (@workspace_id, @name, @description, @is_active, @status, @deployed_by)
RETURNING *;

-- name: UpdateMonitoringProfile :one
UPDATE monitoring_profiles
SET name = @name, description = @description, is_active = @is_active, status = @status, updated_at = NOW()
WHERE id = @id AND workspace_id = @workspace_id
RETURNING *;

-- name: UpdateAgentStatus :one
-- Toggles an agent between active/paused without touching its config.
UPDATE monitoring_profiles
SET status = @status, is_active = (@status = 'active'), updated_at = NOW()
WHERE id = @id AND workspace_id = @workspace_id
RETURNING *;

-- name: TouchAgentRun :one
-- Called by the monitor after each scan to record last-run telemetry.
UPDATE monitoring_profiles
SET last_run_at = NOW(),
    last_run_mentions = @last_run_mentions,
    total_mentions = total_mentions + @last_run_mentions,
    updated_at = NOW()
WHERE id = @id
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

-- name: GetAgentStats :one
-- Aggregated stats for a single agent over a rolling window. The mentions
-- join goes via keywords.profile_id so deletions stay consistent.
SELECT
  COUNT(DISTINCT m.id)::int AS mentions,
  COUNT(DISTINCT r.id)::int AS replies,
  COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'posted')::int AS replies_posted,
  COUNT(DISTINCT l.id)::int AS leads,
  COUNT(DISTINCT l.id) FILTER (WHERE l.stage = 'converted')::int AS leads_converted
FROM monitoring_profiles mp
LEFT JOIN keywords k ON k.profile_id = mp.id
LEFT JOIN mentions m ON m.keyword_id = k.id AND m.created_at >= @since
LEFT JOIN replies r ON r.mention_id = m.id
LEFT JOIN leads l ON l.mention_id = m.id
WHERE mp.id = @profile_id AND mp.workspace_id = @workspace_id;

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

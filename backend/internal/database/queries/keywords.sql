-- name: ListKeywords :many
SELECT id, workspace_id, profile_id, term,
    platforms::text[] as platforms,
    is_active, match_type, negative_terms, subreddits, created_at, updated_at
FROM keywords
WHERE workspace_id = @workspace_id
ORDER BY created_at DESC;

-- name: ListKeywordsByProfile :many
SELECT id, workspace_id, profile_id, term,
    platforms::text[] as platforms,
    is_active, match_type, negative_terms, subreddits, created_at, updated_at
FROM keywords
WHERE workspace_id = @workspace_id AND profile_id = @profile_id
ORDER BY created_at DESC;

-- name: ListActiveKeywords :many
SELECT id, workspace_id, profile_id, term,
    platforms::text[] as platforms,
    is_active, match_type, negative_terms, subreddits, created_at, updated_at
FROM keywords
WHERE workspace_id = @workspace_id AND is_active = true
ORDER BY created_at DESC;

-- name: GetKeyword :one
SELECT id, workspace_id, profile_id, term,
    platforms::text[] as platforms,
    is_active, match_type, negative_terms, subreddits, created_at, updated_at
FROM keywords
WHERE id = @id AND workspace_id = @workspace_id;

-- name: CreateKeyword :one
INSERT INTO keywords (
    workspace_id, profile_id, term, platforms, is_active, match_type, negative_terms, subreddits
) VALUES (
    @workspace_id, @profile_id, @term, @platforms::platform_type[], @is_active, @match_type, @negative_terms, @subreddits
) RETURNING id, workspace_id, profile_id, term,
    platforms::text[] as platforms,
    is_active, match_type, negative_terms, subreddits, created_at, updated_at;

-- name: UpdateKeyword :one
UPDATE keywords
SET term = @term,
    platforms = @platforms::platform_type[],
    is_active = @is_active,
    match_type = @match_type,
    negative_terms = @negative_terms,
    subreddits = @subreddits
WHERE id = @id AND workspace_id = @workspace_id
RETURNING id, workspace_id, profile_id, term,
    platforms::text[] as platforms,
    is_active, match_type, negative_terms, subreddits, created_at, updated_at;

-- name: DeleteKeywordByProfile :exec
DELETE FROM keywords
WHERE id = @id AND workspace_id = @workspace_id AND profile_id = @profile_id;

-- name: DeleteKeyword :exec
DELETE FROM keywords
WHERE id = @id AND workspace_id = @workspace_id;

-- name: ListAllActiveKeywords :many
-- Drives the monitor crawl loop. Only return keywords whose owning agent
-- (monitoring profile) is itself active, so pausing an agent actually stops
-- its keywords from being crawled.
SELECT k.id, k.workspace_id, k.profile_id, k.term,
    k.platforms::text[] as platforms,
    k.is_active, k.match_type, k.negative_terms, k.subreddits, k.created_at, k.updated_at
FROM keywords k
JOIN monitoring_profiles mp ON mp.id = k.profile_id
WHERE k.is_active = true AND mp.is_active = true
ORDER BY k.workspace_id, k.created_at DESC;

-- name: CountKeywords :one
SELECT COUNT(*)::int as count FROM keywords
WHERE workspace_id = @workspace_id;

-- name: CountKeywordsByProfile :one
SELECT COUNT(*)::int as count FROM keywords
WHERE workspace_id = @workspace_id AND profile_id = @profile_id;

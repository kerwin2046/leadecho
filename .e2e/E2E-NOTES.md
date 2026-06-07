# LeadEcho E2E Hardening — Iteration Journal

Branch: `e2e-hardening` (off `master` @ 884134e). No pushes without approval.

## Stack (isolated, never touches the dokploy prod stack)
- Postgres: `leadecho-e2e-postgres` @ 127.0.0.1:15433 (pgvector pg16)
- Redis: `leadecho-e2e-redis` @ 127.0.0.1:16380
- API: pm2 `leadecho-api` @ :8090 (native go binary, rebuilt from /opt/leadecho/backend)
- Dashboard: pm2 `leadecho-dash` @ :13100 (vite dev, served at /app/)
- Playwright suite: /opt/leadecho/.e2e/tests
- Go: /usr/local/go (1.25.7). Build: `go build -o /opt/leadecho/.e2e/leadecho-api ./cmd/api`
- Restart API after backend code change: `pm2 restart leadecho-api`

## Environment constraints
- AI keys (OPENAI/GLM/VOYAGE) are EMPTY (even in prod). AI features (scoring,
  embeddings, RAG reply gen) can't run live without keys → seed data + flag.
  Drop keys into `.e2e/backend.e2e.env` and `pm2 restart leadecho-api` to enable.
- Social scraping (Reddit/Twitter/LinkedIn) needs session cookies → seeded, not live.
- `pkill -f leadecho-api` self-kills the calling shell (string match) — never use it.

## Findings / Fixes
### [FIXED] #1 pgvector type never registered → all mention ingestion broken
- Symptom: every HN mention insert failed: `can't scan into dest[24]
  (col: content_embedding): unsupported data type: <nil>`. Inbox stays empty.
- Root cause: `NewPostgresPool` never registered the pgvector codec, so pgx had
  no codec for the `vector` OID; scanning the RETURNING clause failed. Compounded
  by `Mention.ContentEmbedding` being a non-pointer `pgvector.Vector` (column is
  nullable) so NULL couldn't be represented.
- Fix: `internal/database/postgres.go` — `config.AfterConnect` registers
  `pgvector-go/pgx` types on every conn. `internal/database/models.go` —
  `ContentEmbedding` → `*pgvector.Vector`. `go mod tidy`.
- Verified: 59 mentions persist (54 live HN + seed); no scan errors.

### [FIXED] #2 Auth redirects not basepath-aware → land on 404
- Symptom: after login/register the app did `window.location.href = "/inbox"`,
  and logout did `"/login"`. SPA basepath is `/app`, so users landed on `/inbox`
  / `/login` which 404 (dev) or hit the Astro landing (prod) — broken auth UX.
- Fix: `routes/_auth/login.tsx` + `routes/_auth/register.tsx` → `/app/inbox`;
  `lib/auth.tsx` logout → `/app/login`. (`_auth.tsx` `<Navigate to="/inbox">` is
  router-aware and already correct.)
- Verified by: tests/auth.spec.ts (asserts post-auth URL is /app/inbox).

## Feature surface to cover
Pages: index(overview), inbox, pipeline, keywords, knowledge-base, profiles,
analytics, alerts, workflows, browser-sessions, settings, onboarding, + auth.

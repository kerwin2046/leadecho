package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"leadecho/internal/auth"
)

type contextKey string

const claimsKey contextKey = "claims"

// Auth validates the session JWT from the cookie and injects claims into context.
func Auth(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie("session")
			if err != nil {
				http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
				return
			}

			claims, err := auth.ValidateToken(jwtSecret, cookie.Value)
			if err != nil {
				http.Error(w, `{"error":"invalid session"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClaimsFromContext extracts the JWT claims from the request context.
func ClaimsFromContext(ctx context.Context) *auth.Claims {
	claims, _ := ctx.Value(claimsKey).(*auth.Claims)
	return claims
}

// WorkspaceID extracts the workspace ID from the request context.
// Falls back to the dev workspace ID if no auth is present.
func WorkspaceID(ctx context.Context) string {
	claims := ClaimsFromContext(ctx)
	if claims != nil {
		return claims.WorkspaceID
	}
	return "00000000-0000-0000-0000-000000000001"
}

// UserUUID returns the caller's user ID as a pgtype.UUID for DB columns
// like deployed_by. Returns an invalid UUID when unauthenticated.
func UserUUID(ctx context.Context) pgtype.UUID {
	claims := ClaimsFromContext(ctx)
	if claims == nil || claims.UserID == "" {
		return pgtype.UUID{}
	}
	u, err := uuid.Parse(claims.UserID)
	if err != nil {
		return pgtype.UUID{}
	}
	var out pgtype.UUID
	copy(out.Bytes[:], u[:])
	out.Valid = true
	return out
}

// RequireRole returns a middleware that rejects requests when the JWT claims
// do not carry one of the allowed roles. Must be used after Auth.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(roles))
	for _, r := range roles {
		allowed[r] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := ClaimsFromContext(r.Context())
			if claims == nil {
				http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
				return
			}
			if _, ok := allowed[claims.Role]; !ok {
				http.Error(w, `{"error":"insufficient permissions"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAdmin is a convenience wrapper for the admin-only guard.
func RequireAdmin() func(http.Handler) http.Handler {
	return RequireRole("admin")
}

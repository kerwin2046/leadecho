package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"

	"leadecho/internal/database"
)

type EmailHandler struct {
	queries      *database.Queries
	jwtSecret    string
	resendAPIKey string
	frontendURL  string
	logger       zerolog.Logger
}

func NewEmailHandler(jwtSecret, resendAPIKey string, q *database.Queries, logger zerolog.Logger) *EmailHandler {
	return &EmailHandler{
		queries:      q,
		jwtSecret:    jwtSecret,
		resendAPIKey: resendAPIKey,
		logger:       logger,
	}
}

// NewEmailHandlerWithFrontend is used by router wiring that needs to know the
// frontend URL (for invite acceptance links in emails).
func NewEmailHandlerWithFrontend(jwtSecret, resendAPIKey, frontendURL string, q *database.Queries, logger zerolog.Logger) *EmailHandler {
	h := NewEmailHandler(jwtSecret, resendAPIKey, q, logger)
	h.frontendURL = frontendURL
	return h
}

func (h *EmailHandler) sendWelcomeEmail(name, email string) {
	if h.resendAPIKey == "" {
		return
	}
	html := fmt.Sprintf(`<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#0d1117">
  <h1 style="font-size:1.6rem;font-weight:800;margin-bottom:8px">Welcome to LeadEcho, %s!</h1>
  <p style="color:#636e7b;margin-bottom:24px">You're now set up to find buyers before they find your competitors.</p>
  <h2 style="font-size:1rem;font-weight:700;margin-bottom:12px">Get started in 3 steps:</h2>
  <ol style="color:#444d56;padding-left:20px;line-height:1.8">
    <li><strong>Add keywords</strong> — go to Keywords and add terms your buyers use</li>
    <li><strong>Create a pain-point profile</strong> — describe the problem you solve in plain English</li>
    <li><strong>Install the Chrome extension</strong> — collect signals as you browse and post replies with one click</li>
  </ol>
  <div style="margin-top:32px">
    <a href="https://app.leadecho.io/inbox" style="background:#27c17b;color:#0d1117;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;display:inline-block">Open your inbox →</a>
  </div>
  <p style="margin-top:32px;font-size:0.8rem;color:#999">Questions? Just reply to this email.</p>
</div>`, name)

	payload, _ := json.Marshal(map[string]any{
		"from":    "LeadEcho <hello@leadecho.io>",
		"to":      []string{email},
		"subject": "Welcome to LeadEcho — let's find your first lead",
		"html":    html,
	})

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		h.logger.Warn().Err(err).Str("email", email).Msg("welcome email: failed to build request")
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.resendAPIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.logger.Warn().Err(err).Str("email", email).Msg("welcome email: send failed")
		return
	}
	defer resp.Body.Close()
	h.logger.Info().Str("email", email).Int("status", resp.StatusCode).Msg("welcome email sent")
}

// SetupStatus reports whether the first-run admin setup has been completed.
// Public endpoint — used by the frontend to decide whether to show /setup or /login.
func (h *EmailHandler) SetupStatus(w http.ResponseWriter, r *http.Request) {
	count, err := h.queries.CountUsers(r.Context())
	if err != nil {
		h.logger.Error().Err(err).Msg("setup status: count users failed")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to check setup status"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"setup_required": count == 0,
		"user_count":     count,
	})
}

// Setup creates the very first admin user + workspace. Only works when no
// users exist yet. After this, joining is invite-only.
func (h *EmailHandler) Setup(w http.ResponseWriter, r *http.Request) {
	// Guard: only available when zero users exist.
	count, err := h.queries.CountUsers(r.Context())
	if err != nil {
		h.logger.Error().Err(err).Msg("setup: count users failed")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "setup failed"})
		return
	}
	if count > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "setup already completed; ask a workspace admin to invite you"})
		return
	}

	var body struct {
		Email     string `json:"email"`
		Password  string `json:"password"`
		Name      string `json:"name"`
		Workspace string `json:"workspace_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	body.Name = strings.TrimSpace(body.Name)
	body.Workspace = strings.TrimSpace(body.Workspace)
	if body.Workspace == "" {
		body.Workspace = body.Name + "'s Workspace"
	}

	if body.Email == "" || body.Password == "" || body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email, password, and name are required"})
		return
	}
	if len(body.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be at least 8 characters"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to hash password")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "setup failed"})
		return
	}

	emailID := "email_" + body.Email
	slug := "ws-" + randomHex(6)

	workspace, err := h.queries.CreateWorkspace(r.Context(), database.CreateWorkspaceParams{
		ClerkOrgID: emailID + "_org",
		Name:       body.Workspace,
		Slug:       slug,
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to create workspace")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "setup failed"})
		return
	}

	user, err := h.queries.CreateUser(r.Context(), database.CreateUserParams{
		ClerkUserID:   emailID,
		WorkspaceID:   workspace.ID,
		Email:         body.Email,
		Name:          body.Name,
		AvatarUrl:     pgtype.Text{},
		Role:          database.UserRoleAdmin,
		PasswordHash:  pgtype.Text{String: string(hash), Valid: true},
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to create admin user")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "setup failed"})
		return
	}

	// Mark setup complete.
	if _, err := h.queries.CompleteWorkspaceSetup(r.Context(), workspace.ID); err != nil {
		h.logger.Warn().Err(err).Msg("failed to mark workspace setup_completed_at")
	}

	token, err := IssueToken(h.jwtSecret, user.ID, workspace.ID, user.Email, user.Name, string(user.Role))
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to issue JWT")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "setup failed"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    token,
		Path:     "/",
		MaxAge:   7 * 24 * 60 * 60,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	h.logger.Info().Str("email", body.Email).Str("user_id", user.ID).Msg("initial admin setup completed")
	go h.sendWelcomeEmail(user.Name, user.Email)

	writeJSON(w, http.StatusCreated, map[string]any{
		"user_id":      user.ID,
		"workspace_id": workspace.ID,
		"email":        user.Email,
		"name":         user.Name,
		"role":         string(user.Role),
	})
}

// GetInvite returns public details about an invitation by token. No auth —
// the recipient needs to see this before they have an account.
func (h *EmailHandler) GetInvite(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing invite token"})
		return
	}

	inv, err := h.queries.GetInvitationByToken(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "invitation not found"})
		return
	}

	// Don't leak inviter PII; just expose what the accept page needs.
	resp := map[string]any{
		"email":       inv.Email,
		"role":        string(inv.Role),
		"expires_at":  inv.ExpiresAt,
		"accepted":    inv.AcceptedAt.Valid,
		"expired":     inv.ExpiresAt.Before(time.Now()),
		"workspace_id": inv.WorkspaceID,
	}
	writeJSON(w, http.StatusOK, resp)
}

// AcceptInvite lets a teammate claim an invitation by setting a password.
// Creates the user inside the inviter's workspace and marks the invite accepted.
func (h *EmailHandler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing invite token"})
		return
	}

	var body struct {
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || body.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and password are required"})
		return
	}
	if len(body.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be at least 8 characters"})
		return
	}

	inv, err := h.queries.GetInvitationByToken(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "invitation not found"})
		return
	}
	if inv.AcceptedAt.Valid {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "invitation already accepted"})
		return
	}
	if inv.ExpiresAt.Before(time.Now()) {
		writeJSON(w, http.StatusGone, map[string]string{"error": "invitation has expired"})
		return
	}

	// If email already has an account in this workspace, refuse — they should log in.
	existing, err := h.queries.FindUserByEmail(r.Context(), inv.Email)
	if err == nil && existing.WorkspaceID == inv.WorkspaceID {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "an account with this email already exists; log in instead"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to hash password")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to accept invitation"})
		return
	}

	emailID := "email_" + inv.Email
	user, err := h.queries.CreateUser(r.Context(), database.CreateUserParams{
		ClerkUserID:   emailID,
		WorkspaceID:   inv.WorkspaceID,
		Email:         inv.Email,
		Name:          body.Name,
		AvatarUrl:     pgtype.Text{},
		Role:          inv.Role,
		PasswordHash:  pgtype.Text{String: string(hash), Valid: true},
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to create invited user")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to accept invitation"})
		return
	}

	if _, err := h.queries.MarkInvitationAccepted(r.Context(), database.MarkInvitationAcceptedParams{
		AcceptedBy: uuidToPgtype(user.ID),
		ID:         inv.ID,
	}); err != nil {
		h.logger.Warn().Err(err).Msg("failed to mark invitation accepted")
	}

	jwtToken, err := IssueToken(h.jwtSecret, user.ID, inv.WorkspaceID, user.Email, user.Name, string(user.Role))
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to issue JWT")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to accept invitation"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    jwtToken,
		Path:     "/",
		MaxAge:   7 * 24 * 60 * 60,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	h.logger.Info().Str("email", inv.Email).Str("user_id", user.ID).Msg("invitation accepted")
	writeJSON(w, http.StatusCreated, map[string]any{
		"user_id":      user.ID,
		"workspace_id": inv.WorkspaceID,
		"email":        user.Email,
		"name":         user.Name,
		"role":         string(user.Role),
	})
}

// Login authenticates with email/password.
func (h *EmailHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	body.Email = strings.TrimSpace(strings.ToLower(body.Email))

	if body.Email == "" || body.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password are required"})
		return
	}

	user, err := h.queries.FindUserByEmail(r.Context(), body.Email)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}

	if !user.PasswordHash.Valid {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(body.Password)); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}

	token, err := IssueToken(h.jwtSecret, user.ID, user.WorkspaceID, user.Email, user.Name, string(user.Role))
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to issue JWT")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "login failed"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    token,
		Path:     "/",
		MaxAge:   7 * 24 * 60 * 60,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":      user.ID,
		"workspace_id": user.WorkspaceID,
		"email":        user.Email,
		"name":         user.Name,
		"role":         string(user.Role),
	})
}

// Me returns the current authenticated user.
func (h *EmailHandler) Me(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session")
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}

	claims, err := ValidateToken(h.jwtSecret, cookie.Value)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":      claims.UserID,
		"workspace_id": claims.WorkspaceID,
		"email":        claims.Email,
		"name":         claims.Name,
		"role":         claims.Role,
	})
}

// Logout clears the session cookie.
func (h *EmailHandler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}

// ─── Admin: team membership management ────────────────────────────────────

// CreateInvite lets an admin send an invitation by email. The invite token is
// returned to the caller so the admin can share a magic link directly (we do
// not silently email outbound from this endpoint — Resend is optional).
// POST /auth/invites  { email, role? }
func (h *EmailHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	claims, ok := h.claims(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}

	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if body.Email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email is required"})
		return
	}

	role := database.UserRoleViewer
	switch body.Role {
	case "admin":
		role = database.UserRoleAdmin
	case "editor":
		role = database.UserRoleEditor
	case "viewer", "":
		role = database.UserRoleViewer
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid role; must be admin, editor, or viewer"})
		return
	}

	// Refuse if email is already a member of this workspace.
	if existing, err := h.queries.FindUserByEmail(r.Context(), body.Email); err == nil && existing.WorkspaceID == claims.WorkspaceID {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "this email is already a member of the workspace"})
		return
	}

	token := randomHex(32)
	inv, err := h.queries.CreateInvitation(r.Context(), database.CreateInvitationParams{
		WorkspaceID: claims.WorkspaceID,
		Email:       body.Email,
		Role:        role,
		Token:       token,
		InvitedBy:   claims.UserID,
		ExpiresAt:   time.Now().Add(7 * 24 * time.Hour),
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to create invitation")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create invitation"})
		return
	}

	// Best-effort: email the invite link if Resend is configured.
	go h.sendInviteEmail(body.Email, token)

	inviteLink := h.frontendURL + "/invite/" + token
	h.logger.Info().Str("email", body.Email).Str("invited_by", claims.UserID).Msg("invitation created")
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":           inv.ID,
		"email":        inv.Email,
		"role":         string(inv.Role),
		"expires_at":   inv.ExpiresAt,
		"invite_url":   inviteLink,
		"token":        token,
	})
}

// ListInvites returns all invitations for the admin's workspace.
// GET /auth/invites
func (h *EmailHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	claims, ok := h.claims(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}
	invites, err := h.queries.ListInvitationsByWorkspace(r.Context(), claims.WorkspaceID)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to list invitations")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list invitations"})
		return
	}
	type inviteRow struct {
		ID         string    `json:"id"`
		Email      string    `json:"email"`
		Role       string    `json:"role"`
		ExpiresAt  time.Time `json:"expires_at"`
		Accepted   bool      `json:"accepted"`
		InviteURL  string    `json:"invite_url,omitempty"`
		CreatedAt  time.Time `json:"created_at"`
	}
	out := make([]inviteRow, 0, len(invites))
	for _, inv := range invites {
		row := inviteRow{
			ID:        inv.ID,
			Email:     inv.Email,
			Role:      string(inv.Role),
			ExpiresAt: inv.ExpiresAt,
			Accepted:  inv.AcceptedAt.Valid,
			CreatedAt: inv.CreatedAt,
		}
		if !inv.AcceptedAt.Valid {
			row.InviteURL = h.frontendURL + "/invite/" + inv.Token
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, out)
}

// RevokeInvite deletes a pending invitation.
// DELETE /auth/invites/{id}
func (h *EmailHandler) RevokeInvite(w http.ResponseWriter, r *http.Request) {
	claims, ok := h.claims(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing invite id"})
		return
	}
	if err := h.queries.DeleteInvitation(r.Context(), database.DeleteInvitationParams{
		ID:          id,
		WorkspaceID: claims.WorkspaceID,
	}); err != nil {
		h.logger.Error().Err(err).Msg("failed to revoke invitation")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to revoke invitation"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// ListMembers returns all users in the caller's workspace.
// GET /auth/members
func (h *EmailHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	claims, ok := h.claims(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}
	users, err := h.queries.ListUsersByWorkspace(r.Context(), claims.WorkspaceID)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to list members")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list members"})
		return
	}
	type memberRow struct {
		ID        string    `json:"id"`
		Email     string    `json:"email"`
		Name      string    `json:"name"`
		Role      string    `json:"role"`
		Active    bool      `json:"active"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := make([]memberRow, 0, len(users))
	for _, u := range users {
		out = append(out, memberRow{
			ID:        u.ID,
			Email:     u.Email,
			Name:      u.Name,
			Role:      string(u.Role),
			Active:    u.IsActive,
			CreatedAt: u.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// ─── helpers ──────────────────────────────────────────────────────────────

func (h *EmailHandler) claims(r *http.Request) (*Claims, bool) {
	cookie, err := r.Cookie("session")
	if err != nil {
		return nil, false
	}
	c, err := ValidateToken(h.jwtSecret, cookie.Value)
	if err != nil {
		return nil, false
	}
	return c, true
}

func uuidToPgtype(s string) pgtype.UUID {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}
	}
	var out pgtype.UUID
	copy(out.Bytes[:], u[:])
	out.Valid = true
	return out
}

func (h *EmailHandler) sendInviteEmail(email, token string) {
	if h.resendAPIKey == "" || h.frontendURL == "" {
		return
	}
	link := h.frontendURL + "/invite/" + token
	html := fmt.Sprintf(`<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#0d1117">
  <h1 style="font-size:1.4rem;font-weight:800;margin-bottom:8px">You're invited to join LeadEcho</h1>
  <p style="color:#636e7b;margin-bottom:24px">Your team is waiting for you. Click the button below to accept the invitation and set up your account.</p>
  <div style="margin-top:24px">
    <a href="%s" style="background:#27c17b;color:#0d1117;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;display:inline-block">Accept invitation →</a>
  </div>
  <p style="margin-top:24px;font-size:0.8rem;color:#999">This link expires in 7 days. If you weren't expecting this invitation, you can safely ignore this email.</p>
</div>`, link)

	payload, _ := json.Marshal(map[string]any{
		"from":    "LeadEcho <hello@leadecho.io>",
		"to":      []string{email},
		"subject": "You're invited to join LeadEcho",
		"html":    html,
	})

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		h.logger.Warn().Err(err).Msg("invite email: failed to build request")
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.resendAPIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.logger.Warn().Err(err).Msg("invite email: send failed")
		return
	}
	defer resp.Body.Close()
	h.logger.Info().Str("email", email).Int("status", resp.StatusCode).Msg("invite email sent")
}

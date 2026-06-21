package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"leadecho/internal/api/middleware"
	"leadecho/internal/database"
	"leadecho/internal/embedding"
)

// AgentHandler exposes the /agents endpoints. List/Get/stats are open to all
// workspace members; Create/Update/Delete/Pause/Resume are admin-only (router
// enforces via middleware.RequireAdmin).
type AgentHandler struct {
	q        *database.Queries
	embedder *embedding.Client
}

func NewAgentHandler(q *database.Queries, embedder *embedding.Client) *AgentHandler {
	return &AgentHandler{q: q, embedder: embedder}
}

// AgentResponse is the canonical agent shape returned by List/Get/Create/Update.
// It augments the monitoring_profile row with pain points + roll-up counts.
type AgentResponse struct {
	ID              string   `json:"id"`
	WorkspaceID     string   `json:"workspace_id"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Status          string   `json:"status"`
	IsActive        bool     `json:"is_active"`
	PainPoints      []string `json:"pain_points"`
	KeywordCount    int      `json:"keyword_count"`
	PainPointCount  int      `json:"pain_point_count"`
	LastRunAt       *string  `json:"last_run_at,omitempty"`
	LastRunMentions *int     `json:"last_run_mentions,omitempty"`
	TotalMentions   int      `json:"total_mentions"`
	DeployedAt      string   `json:"deployed_at"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

// ListAgents returns every agent in the caller's workspace with roll-up counts.
// Open to all members (editor/viewer can see what's running).
// GET /agents
func (h *AgentHandler) List(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.WorkspaceID(r.Context())
	rows, err := h.q.ListAgents(r.Context(), wsID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agents")
		return
	}
	resp := make([]AgentResponse, 0, len(rows))
	for _, row := range rows {
		agent := h.rowToAgentResponse(r.Context(), row)
		resp = append(resp, agent)
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetAgent returns a single agent with pain points + counts.
// GET /agents/{id}
func (h *AgentHandler) Get(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.WorkspaceID(r.Context())
	id := chi.URLParam(r, "id")
	p, err := h.q.GetMonitoringProfile(r.Context(), database.GetMonitoringProfileParams{ID: id, WorkspaceID: wsID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "agent not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to fetch agent")
		return
	}
	kwCount, _ := h.q.CountKeywordsByProfile(r.Context(), database.CountKeywordsByProfileParams{
		WorkspaceID: wsID, ProfileID: id,
	})
	resp := h.profileToAgentResponse(r.Context(), p, int(kwCount))
	writeJSON(w, http.StatusOK, resp)
}

// CreateAgent creates a new agent. Admin-only.
// POST /agents  { name, description, pain_points?, keywords? }
func (h *AgentHandler) Create(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.WorkspaceID(r.Context())

	var body struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		PainPoints  []string `json:"pain_points"`
		Keywords    []struct {
			Term          string   `json:"term"`
			Platforms     []string `json:"platforms"`
			Subreddits    []string `json:"subreddits"`
			NegativeTerms []string `json:"negative_terms"`
			MatchType     string   `json:"match_type"`
		} `json:"keywords"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.PainPoints == nil {
		body.PainPoints = []string{}
	}

	profile, err := h.q.CreateMonitoringProfile(r.Context(), database.CreateMonitoringProfileParams{
		WorkspaceID: wsID,
		Name:        body.Name,
		Description: body.Description,
		IsActive:    true,
		Status:      "active",
		DeployedBy:  middleware.UserUUID(r.Context()),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create agent")
		return
	}

	// Embed + store pain points (best-effort).
	if len(body.PainPoints) > 0 && h.embedder != nil {
		_ = h.embedAndStorePhrases(r.Context(), profile.ID, wsID, body.PainPoints)
	}

	// Create associated keywords (best-effort — duplicates are tolerated).
	for _, kw := range body.Keywords {
		term := strings.TrimSpace(kw.Term)
		if term == "" {
			continue
		}
		platforms := kw.Platforms
		if platforms == nil || len(platforms) == 0 {
			platforms = []string{"hackernews", "reddit"}
		}
		if kw.MatchType == "" {
			kw.MatchType = "contains"
		}
		if kw.NegativeTerms == nil {
			kw.NegativeTerms = []string{}
		}
		if kw.Subreddits == nil {
			kw.Subreddits = []string{}
		}
		_, _ = h.q.CreateKeyword(r.Context(), database.CreateKeywordParams{
			WorkspaceID:   wsID,
			ProfileID:     profile.ID,
			Term:          term,
			Platforms:     platforms,
			IsActive:      true,
			MatchType:     kw.MatchType,
			NegativeTerms: kw.NegativeTerms,
			Subreddits:    kw.Subreddits,
		})
	}

	kwCount, _ := h.q.CountKeywordsByProfile(r.Context(), database.CountKeywordsByProfileParams{
		WorkspaceID: wsID, ProfileID: profile.ID,
	})
	writeJSON(w, http.StatusCreated, h.profileToAgentResponse(r.Context(), profile, int(kwCount)))
}

// UpdateAgent updates an agent's name/description/pain points. Admin-only.
// PUT /agents/{id}
func (h *AgentHandler) Update(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.WorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Name        *string  `json:"name"`
		Description *string  `json:"description"`
		PainPoints  []string `json:"pain_points"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	existing, err := h.q.GetMonitoringProfile(r.Context(), database.GetMonitoringProfileParams{ID: id, WorkspaceID: wsID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "agent not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to fetch agent")
		return
	}

	name := existing.Name
	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		name = strings.TrimSpace(*body.Name)
	}
	description := existing.Description
	if body.Description != nil {
		description = *body.Description
	}

	profile, err := h.q.UpdateMonitoringProfile(r.Context(), database.UpdateMonitoringProfileParams{
		ID:          id,
		WorkspaceID: wsID,
		Name:        name,
		Description: description,
		IsActive:    existing.IsActive,
		Status:      existing.Status,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update agent")
		return
	}

	// Re-embed pain points only if the caller supplied them.
	// Embed first, then swap — never wipe existing embeddings on embed failure.
	if body.PainPoints != nil && h.embedder != nil {
		if len(body.PainPoints) > 0 {
			vectors, err := h.embedder.EmbedTexts(r.Context(), body.PainPoints)
			if err != nil {
				writeError(w, http.StatusBadGateway, "failed to embed pain points; existing phrases preserved")
				return
			}
			h.q.DeletePainPointEmbeddingsByProfile(r.Context(), id)
			for i, phrase := range body.PainPoints {
				if i >= len(vectors) {
					break
				}
				h.q.CreatePainPointEmbedding(r.Context(), database.CreatePainPointEmbeddingParams{
					ProfileID:   id,
					WorkspaceID: wsID,
					Phrase:      phrase,
					Embedding:   &vectors[i],
				})
			}
		} else {
			h.q.DeletePainPointEmbeddingsByProfile(r.Context(), id)
		}
	}

	kwCount, _ := h.q.CountKeywordsByProfile(r.Context(), database.CountKeywordsByProfileParams{
		WorkspaceID: wsID, ProfileID: id,
	})
	writeJSON(w, http.StatusOK, h.profileToAgentResponse(r.Context(), profile, int(kwCount)))
}

// PauseAgent flips an agent to paused (monitor will skip it next tick).
// POST /agents/{id}/pause   Admin-only.
func (h *AgentHandler) Pause(w http.ResponseWriter, r *http.Request) {
	h.setStatus(w, r, "paused")
}

// ResumeAgent flips an agent back to active.
// POST /agents/{id}/resume   Admin-only.
func (h *AgentHandler) Resume(w http.ResponseWriter, r *http.Request) {
	h.setStatus(w, r, "active")
}

func (h *AgentHandler) setStatus(w http.ResponseWriter, r *http.Request, status string) {
	wsID := middleware.WorkspaceID(r.Context())
	id := chi.URLParam(r, "id")
	profile, err := h.q.UpdateAgentStatus(r.Context(), database.UpdateAgentStatusParams{
		ID:          id,
		WorkspaceID: wsID,
		Status:      status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "agent not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update agent status")
		return
	}
	kwCount, _ := h.q.CountKeywordsByProfile(r.Context(), database.CountKeywordsByProfileParams{
		WorkspaceID: wsID, ProfileID: id,
	})
	writeJSON(w, http.StatusOK, h.profileToAgentResponse(r.Context(), profile, int(kwCount)))
}

// DeleteAgent removes an agent and cascades to its keywords/pain points.
// DELETE /agents/{id}   Admin-only.
func (h *AgentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.WorkspaceID(r.Context())
	id := chi.URLParam(r, "id")
	if _, err := h.q.GetMonitoringProfile(r.Context(), database.GetMonitoringProfileParams{ID: id, WorkspaceID: wsID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "agent not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete agent")
		return
	}
	if err := h.q.DeleteMonitoringProfile(r.Context(), database.DeleteMonitoringProfileParams{ID: id, WorkspaceID: wsID}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete agent")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// AgentStats returns 7/30-day roll-up for an agent.
// GET /agents/{id}/stats?window=7|30   Open to all members.
func (h *AgentHandler) Stats(w http.ResponseWriter, r *http.Request) {
	wsID := middleware.WorkspaceID(r.Context())
	id := chi.URLParam(r, "id")

	window := 7
	if w := r.URL.Query().Get("window"); w == "30" {
		window = 30
	}
	since := time.Now().AddDate(0, 0, -window)

	stats, err := h.q.GetAgentStats(r.Context(), database.GetAgentStatsParams{
		ProfileID:   id,
		WorkspaceID: wsID,
		Since:       since,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch agent stats")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"window":           window,
		"mentions":         stats.Mentions,
		"replies":          stats.Replies,
		"replies_posted":   stats.RepliesPosted,
		"leads":            stats.Leads,
		"leads_converted":  stats.LeadsConverted,
	})
}

// ─── helpers ──────────────────────────────────────────────────────────────

// rowToAgentResponse converts a ListAgentsRow (the flat SELECT with roll-up
// counts) into an AgentResponse. Loads pain points separately.
func (h *AgentHandler) rowToAgentResponse(ctx context.Context, row database.ListAgentsRow) AgentResponse {
	resp := AgentResponse{
		ID:            row.ID,
		WorkspaceID:   row.WorkspaceID,
		Name:          row.Name,
		Description:   row.Description,
		Status:        row.Status,
		IsActive:      row.IsActive,
		TotalMentions: int(row.TotalMentions),
		KeywordCount:  int(row.KeywordCount),
		PainPointCount: int(row.PainPointCount),
		CreatedAt:     row.CreatedAt.Format(time.RFC3339),
		UpdatedAt:     row.UpdatedAt.Format(time.RFC3339),
		PainPoints:    []string{},
	}
	if row.LastRunAt.Valid {
		s := row.LastRunAt.Time.Format(time.RFC3339)
		resp.LastRunAt = &s
	}
	if row.LastRunMentions.Valid {
		n := int(row.LastRunMentions.Int32)
		resp.LastRunMentions = &n
	}
	if row.DeployedAt.Valid {
		resp.DeployedAt = row.DeployedAt.Time.Format(time.RFC3339)
	}
	// Load pain-point phrases for display.
	embeddings, _ := h.q.ListPainPointEmbeddings(ctx, row.ID)
	resp.PainPoints = make([]string, 0, len(embeddings))
	for _, e := range embeddings {
		resp.PainPoints = append(resp.PainPoints, e.Phrase)
	}
	if resp.PainPointCount == 0 && len(resp.PainPoints) > 0 {
		resp.PainPointCount = len(resp.PainPoints)
	}
	return resp
}

// profileToAgentResponse converts a single MonitoringProfile row into an
// AgentResponse, loading pain points + (optionally) keyword count from DB.
func (h *AgentHandler) profileToAgentResponse(ctx context.Context, p database.MonitoringProfile, kwCount int) AgentResponse {
	resp := AgentResponse{
		ID:            p.ID,
		WorkspaceID:   p.WorkspaceID,
		Name:          p.Name,
		Description:   p.Description,
		Status:        p.Status,
		IsActive:      p.IsActive,
		TotalMentions: int(p.TotalMentions),
		KeywordCount:  kwCount,
		CreatedAt:     p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:     p.UpdatedAt.Format(time.RFC3339),
		PainPoints:    []string{},
	}
	if p.LastRunAt.Valid {
		s := p.LastRunAt.Time.Format(time.RFC3339)
		resp.LastRunAt = &s
	}
	if p.LastRunMentions.Valid {
		n := int(p.LastRunMentions.Int32)
		resp.LastRunMentions = &n
	}
	if p.DeployedAt.Valid {
		resp.DeployedAt = p.DeployedAt.Time.Format(time.RFC3339)
	}
	embeddings, _ := h.q.ListPainPointEmbeddings(ctx, p.ID)
	resp.PainPointCount = len(embeddings)
	resp.PainPoints = make([]string, 0, len(embeddings))
	for _, e := range embeddings {
		resp.PainPoints = append(resp.PainPoints, e.Phrase)
	}
	return resp
}

func (h *AgentHandler) embedAndStorePhrases(ctx context.Context, profileID, wsID string, phrases []string) error {
	vectors, err := h.embedder.EmbedTexts(ctx, phrases)
	if err != nil {
		return err
	}
	for i, phrase := range phrases {
		if i >= len(vectors) {
			break
		}
		h.q.CreatePainPointEmbedding(ctx, database.CreatePainPointEmbeddingParams{
			ProfileID:   profileID,
			WorkspaceID: wsID,
			Phrase:      phrase,
			Embedding:   &vectors[i],
		})
	}
	return nil
}

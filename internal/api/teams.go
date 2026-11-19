package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
)

type teamMemberInput struct {
	AgentID      string `json:"agentId"`
	RoleOverride string `json:"roleOverride"`
	Position     int    `json:"position"`
}

type createTeamInput struct {
	WorkspaceID    string   `json:"workspaceId"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	MemberAgentIDs []string `json:"memberAgentIds"`
}

type patchTeamInput struct {
	Name             *string `json:"name"`
	Description      *string `json:"description"`
	ExpectedRevision int     `json:"expectedRevision"`
}

func (a *API) listAgentTeams(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r, 50)
	teams, err := a.store.ListAgentTeams(r.Context(), r.URL.Query().Get("workspaceId"), r.URL.Query().Get("status"), limit, offset)
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	for index := range teams {
		teams[index].Members, _ = a.store.ListAgentTeamMembers(r.Context(), teams[index].ID)
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"teams": teams})
}

func (a *API) createAgentTeam(w http.ResponseWriter, r *http.Request) {
	var input createTeamInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "name is required", nil)
		return
	}
	if input.WorkspaceID == "" {
		input.WorkspaceID = domain.DefaultWorkspaceID
	}
	agents := make([]*domain.Agent, 0, len(input.MemberAgentIDs))
	seen := map[string]bool{}
	for _, agentID := range input.MemberAgentIDs {
		agentID = strings.TrimSpace(agentID)
		if agentID == "" || seen[agentID] {
			continue
		}
		seen[agentID] = true
		agent, err := a.store.GetAgent(r.Context(), agentID)
		if err != nil {
			a.handleStoreError(w, err)
			return
		}
		if agent.WorkspaceID != input.WorkspaceID {
			a.writeAPIError(w, http.StatusConflict, "WORKSPACE_MISMATCH", "all members must belong to the team workspace", map[string]any{"agentId": agentID})
			return
		}
		agents = append(agents, agent)
	}
	team := &domain.AgentTeam{
		WorkspaceID: input.WorkspaceID,
		Name:        input.Name,
		Description: input.Description,
		Status:      domain.AgentTeamActive,
	}
	if err := a.store.CreateAgentTeam(r.Context(), team); err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	for index, agent := range agents {
		if err := a.store.AddAgentTeamMember(r.Context(), team.ID, domain.AgentTeamMember{
			AgentID: agent.ID, Position: index, JoinedAt: domain.Now(),
		}); err != nil {
			a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
			return
		}
	}
	team.Members, _ = a.store.ListAgentTeamMembers(r.Context(), team.ID)
	a.broadcast("agent_team.created", team)
	a.writeJSON(w, http.StatusCreated, team)
}

func (a *API) getAgentTeam(w http.ResponseWriter, r *http.Request) {
	team, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	team.Members, _ = a.store.ListAgentTeamMembers(r.Context(), team.ID)
	a.writeJSON(w, http.StatusOK, team)
}

func (a *API) updateAgentTeam(w http.ResponseWriter, r *http.Request) {
	team, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if team.Status != domain.AgentTeamActive {
		a.writeAPIError(w, http.StatusConflict, "TEAM_ARCHIVED", "team is archived", nil)
		return
	}
	var input patchTeamInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "name cannot be empty", nil)
			return
		}
		team.Name = name
	}
	if input.Description != nil {
		team.Description = *input.Description
	}
	ok, err := a.store.UpdateAgentTeam(r.Context(), team, input.ExpectedRevision)
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	if !ok {
		a.writeAPIError(w, http.StatusConflict, "STALE_REVISION", "team was modified by another request", nil)
		return
	}
	team.Members, _ = a.store.ListAgentTeamMembers(r.Context(), team.ID)
	a.broadcast("agent_team.updated", team)
	a.writeJSON(w, http.StatusOK, team)
}

func (a *API) archiveAgentTeam(w http.ResponseWriter, r *http.Request) {
	team, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if team.Status != domain.AgentTeamArchived {
		if err := a.store.ArchiveAgentTeam(r.Context(), team.ID); err != nil {
			a.handleStoreError(w, err)
			return
		}
		team, _ = a.store.GetAgentTeam(r.Context(), team.ID)
	}
	team.Members, _ = a.store.ListAgentTeamMembers(r.Context(), team.ID)
	a.broadcast("agent_team.archived", map[string]any{"id": team.ID})
	a.writeJSON(w, http.StatusOK, team)
}

func (a *API) listAgentTeamMembers(w http.ResponseWriter, r *http.Request) {
	if _, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id")); err != nil {
		a.handleStoreError(w, err)
		return
	}
	members, err := a.store.ListAgentTeamMembers(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

func (a *API) addAgentTeamMember(w http.ResponseWriter, r *http.Request) {
	team, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if team.Status != domain.AgentTeamActive {
		a.writeAPIError(w, http.StatusConflict, "TEAM_ARCHIVED", "team is archived", nil)
		return
	}
	var input teamMemberInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	input.AgentID = strings.TrimSpace(input.AgentID)
	agent, err := a.store.GetAgent(r.Context(), input.AgentID)
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if agent.WorkspaceID != team.WorkspaceID {
		a.writeAPIError(w, http.StatusConflict, "WORKSPACE_MISMATCH", "agent must belong to the team workspace", map[string]any{"agentId": agent.ID})
		return
	}
	members, _ := a.store.ListAgentTeamMembers(r.Context(), team.ID)
	for _, member := range members {
		if member.AgentID == agent.ID {
			a.writeAPIError(w, http.StatusConflict, "TEAM_MEMBER_EXISTS", "agent is already a team member", map[string]any{"agentId": agent.ID})
			return
		}
	}
	if err := a.store.AddAgentTeamMember(r.Context(), team.ID, domain.AgentTeamMember{
		AgentID: agent.ID, RoleOverride: input.RoleOverride, Position: input.Position, JoinedAt: domain.Now(),
	}); err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	updated, _ := a.store.ListAgentTeamMembers(r.Context(), team.ID)
	a.broadcast("agent_team.updated", map[string]any{"id": team.ID})
	a.writeJSON(w, http.StatusCreated, map[string]any{"members": updated})
}

func (a *API) removeAgentTeamMember(w http.ResponseWriter, r *http.Request) {
	team, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if team.Status != domain.AgentTeamActive {
		a.writeAPIError(w, http.StatusConflict, "TEAM_ARCHIVED", "team is archived", nil)
		return
	}
	if err := a.store.RemoveAgentTeamMember(r.Context(), team.ID, r.PathValue("agentId")); err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.broadcast("agent_team.updated", map[string]any{"id": team.ID})
	w.WriteHeader(http.StatusNoContent)
}

func pagination(r *http.Request, defaultLimit int) (int, int) {
	limit := defaultLimit
	offset := 0
	if value, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && value > 0 {
		limit = value
	}
	if value, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && value > 0 {
		offset = value
	}
	if limit > 200 {
		limit = 200
	}
	return limit, offset
}

var _ store.Store = (*store.SQLite)(nil)

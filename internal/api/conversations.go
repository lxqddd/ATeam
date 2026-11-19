package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/store"
)

type createConversationInput struct {
	Title string `json:"title"`
}

type patchConversationInput struct {
	Title            *string `json:"title"`
	Status           *string `json:"status"`
	ExpectedRevision int     `json:"expectedRevision"`
}

type sendMessageInput struct {
	Content  string   `json:"content"`
	Mentions []string `json:"mentions"`
}

type convertMessageInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

func (a *API) listConversations(w http.ResponseWriter, r *http.Request) {
	team, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	limit, offset := pagination(r, 50)
	items, err := a.store.ListConversations(r.Context(), team.ID, r.URL.Query().Get("status"), limit, offset)
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"conversations": items})
}

func (a *API) createConversation(w http.ResponseWriter, r *http.Request) {
	team, err := a.store.GetAgentTeam(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if team.Status != domain.AgentTeamActive {
		a.writeAPIError(w, http.StatusConflict, "TEAM_ARCHIVED", "team is archived", nil)
		return
	}
	var input createConversationInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	conversation := &domain.Conversation{
		TeamID:      team.ID,
		WorkspaceID: team.WorkspaceID,
		Title:       strings.TrimSpace(input.Title),
		Status:      domain.ConversationActive,
	}
	if err := a.store.CreateConversation(r.Context(), conversation); err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	a.broadcast("conversation.created", conversation)
	a.writeJSON(w, http.StatusCreated, conversation)
}

func (a *API) getConversation(w http.ResponseWriter, r *http.Request) {
	conversation, err := a.store.GetConversation(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, conversation)
}

func (a *API) updateConversation(w http.ResponseWriter, r *http.Request) {
	conversation, err := a.store.GetConversation(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	var input patchConversationInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	if input.Title != nil {
		conversation.Title = strings.TrimSpace(*input.Title)
	}
	if input.Status != nil {
		status := strings.TrimSpace(*input.Status)
		if status != domain.ConversationActive && status != domain.ConversationArchived {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "status must be active or archived", nil)
			return
		}
		if conversation.Status == domain.ConversationArchived && status == domain.ConversationActive {
			a.writeAPIError(w, http.StatusConflict, "CONVERSATION_ARCHIVED", "archived conversations are read-only", nil)
			return
		}
		if status == domain.ConversationArchived && conversation.ArchivedAt == nil {
			now := domain.Now()
			conversation.ArchivedAt = &now
		}
		conversation.Status = status
	}
	ok, err := a.store.UpdateConversation(r.Context(), conversation, input.ExpectedRevision)
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	if !ok {
		a.writeAPIError(w, http.StatusConflict, "STALE_REVISION", "conversation was modified by another request", nil)
		return
	}
	if conversation.Status == domain.ConversationArchived {
		a.broadcast("conversation.archived", map[string]any{"id": conversation.ID})
	} else {
		a.broadcast("conversation.updated", conversation)
	}
	a.writeJSON(w, http.StatusOK, conversation)
}

func (a *API) listConversationMessages(w http.ResponseWriter, r *http.Request) {
	conversation, err := a.store.GetConversation(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	limit, _ := pagination(r, 50)
	afterSeq := int64(0)
	if value := r.URL.Query().Get("afterSeq"); value != "" {
		_, _ = fmt.Sscanf(value, "%d", &afterSeq)
	}
	messages, err := a.store.ListConversationMessages(r.Context(), conversation.ID, afterSeq, limit)
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (a *API) sendConversationMessage(w http.ResponseWriter, r *http.Request) {
	conversation, err := a.store.GetConversation(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if conversation.Status != domain.ConversationActive {
		a.writeAPIError(w, http.StatusConflict, "CONVERSATION_ARCHIVED", "conversation is archived", nil)
		return
	}
	team, err := a.store.GetAgentTeam(r.Context(), conversation.TeamID)
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if team.Status != domain.AgentTeamActive {
		a.writeAPIError(w, http.StatusConflict, "TEAM_ARCHIVED", "team is archived", nil)
		return
	}
	var input sendMessageInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	input.Content = strings.TrimSpace(input.Content)
	if input.Content == "" {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "content is required", nil)
		return
	}
	if len(input.Content) > 32768 {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "content exceeds 32768 characters", nil)
		return
	}
	members, err := a.store.ListAgentTeamMembers(r.Context(), team.ID)
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	lowerContent := strings.ToLower(input.Content)
	for _, mention := range input.Mentions {
		if !isTeamMember(members, mention) {
			a.writeAPIError(w, http.StatusConflict, "AGENT_NOT_IN_TEAM", "mentioned agent is not a team member", map[string]any{"agentId": mention})
			return
		}
		name := ""
		for _, member := range members {
			if member.AgentID == mention {
				name = member.Name
				break
			}
		}
		if name != "" && !strings.Contains(lowerContent, "@"+strings.ToLower(name)) {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "mentions must match the @Agent references in content", map[string]any{"agentId": mention})
			return
		}
	}
	if len(input.Mentions) == 0 && containsMemberMention(members, input.Content) {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "mentions must be provided for @Agent references", nil)
		return
	}

	message := &domain.ConversationMessage{
		ConversationID: conversation.ID,
		Role:           domain.MessageRoleUser,
		Status:         domain.MessageStatusCompleted,
		Content:        input.Content,
	}
	routing, routeErr := routeConversation(members, input.Content, input.Mentions)
	if err := a.store.AppendConversationMessage(r.Context(), message); err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	routing.ConversationID = conversation.ID
	routing.MessageID = message.ID
	message.Routing = routing
	if routeErr != nil {
		routing.Rationale = "routing failed: " + routeErr.Error()
		_ = a.store.CreateRoutingDecision(r.Context(), routing)
		_ = a.store.UpdateConversationMessage(r.Context(), message)
		a.broadcast("conversation.message.created", message)
		details := map[string]any{"messageId": message.ID, "candidates": routing.Candidates}
		a.writeAPIError(w, http.StatusConflict, routeErr.Error(), "could not route the message", details)
		return
	}
	if err := a.store.CreateRoutingDecision(r.Context(), routing); err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	_ = a.store.UpdateConversationMessage(r.Context(), message)
	a.broadcast("conversation.message.created", message)
	a.broadcast("conversation.routing.decided", map[string]any{
		"conversationId": conversation.ID, "messageId": message.ID, "mode": routing.Mode,
		"source": routing.Source, "selectedAgentId": routing.SelectedAgentID, "rationale": routing.Rationale,
	})

	reply := &domain.ConversationMessage{
		ConversationID: conversation.ID,
		Role:           domain.MessageRoleAgent,
		AgentID:        routing.SelectedAgentID,
		Status:         domain.MessageStatusPending,
		ReplyToID:      message.ID,
	}
	if err := a.store.AppendConversationMessage(r.Context(), reply); err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	a.broadcast("conversation.reply.started", map[string]any{
		"conversationId": conversation.ID, "messageId": reply.ID, "agentId": reply.AgentID,
	})
	go a.runConversationReply(conversation, team, reply, input.Content)

	a.writeJSON(w, http.StatusCreated, map[string]any{
		"message": message, "replyMessageId": reply.ID, "routing": routing,
	})
}

func isTeamMember(members []domain.AgentTeamMember, agentID string) bool {
	for _, member := range members {
		if member.AgentID == agentID {
			return true
		}
	}
	return false
}

func containsMemberMention(members []domain.AgentTeamMember, content string) bool {
	lower := strings.ToLower(content)
	for _, member := range members {
		if strings.Contains(lower, "@"+strings.ToLower(member.Name)) {
			return true
		}
	}
	return false
}

func routeConversation(members []domain.AgentTeamMember, content string, mentions []string) (*domain.ConversationRoutingDecision, error) {
	candidates := make([]domain.RoutingCandidate, 0, len(members))
	for _, member := range members {
		candidates = append(candidates, domain.RoutingCandidate{AgentID: member.AgentID, Name: member.Name, Role: effectiveRole(member)})
	}
	decision := &domain.ConversationRoutingDecision{
		Mode: domain.RoutingModeAuto, Source: domain.RouteSourceRules, Candidates: candidates,
	}
	if len(mentions) > 0 {
		decision.Mode = domain.RoutingModeMention
		decision.Source = domain.RouteSourceMention
		decision.SelectedAgentID = mentions[0]
		for _, member := range members {
			if member.AgentID == mentions[0] {
				decision.Rationale = "@" + member.Name
				break
			}
		}
		return decision, nil
	}
	if len(members) == 0 {
		return decision, fmt.Errorf("ROUTING_NO_MATCH")
	}
	if len(members) == 1 {
		decision.SelectedAgentID = members[0].AgentID
		decision.Rationale = "only team member"
		return decision, nil
	}
	lower := strings.ToLower(content)
	best := 0
	var winners []domain.AgentTeamMember
	for _, member := range members {
		score := 0
		if member.Name != "" && strings.Contains(lower, strings.ToLower(member.Name)) {
			score += 4
		}
		if role := effectiveRole(member); role != "" && strings.Contains(lower, strings.ToLower(role)) {
			score += 2
		}
		switch {
		case score > best:
			best = score
			winners = []domain.AgentTeamMember{member}
		case score == best && score > 0:
			winners = append(winners, member)
		}
	}
	if best == 0 {
		return decision, fmt.Errorf("ROUTING_NO_MATCH")
	}
	if len(winners) > 1 {
		return decision, fmt.Errorf("ROUTING_AMBIGUOUS")
	}
	decision.SelectedAgentID = winners[0].AgentID
	decision.Rationale = "matched " + effectiveRole(winners[0])
	return decision, nil
}

func effectiveRole(member domain.AgentTeamMember) string {
	if member.RoleOverride != "" {
		return member.RoleOverride
	}
	return member.Role
}

func (a *API) cancelConversationReply(w http.ResponseWriter, r *http.Request) {
	message, err := a.store.GetConversationMessage(r.Context(), r.PathValue("messageId"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if message.Role != domain.MessageRoleAgent || message.Status != domain.MessageStatusPending {
		a.writeAPIError(w, http.StatusConflict, "REPLY_NOT_ACTIVE", "reply is not in progress", map[string]any{"messageId": message.ID})
		return
	}
	a.conversationMu.Lock()
	cancel := a.conversationReplies[message.ID]
	a.conversationMu.Unlock()
	if cancel == nil {
		a.writeAPIError(w, http.StatusConflict, "REPLY_NOT_ACTIVE", "reply is not in progress", map[string]any{"messageId": message.ID})
		return
	}
	cancel()
	a.writeJSON(w, http.StatusOK, map[string]any{"messageId": message.ID, "status": domain.MessageStatusCancelled})
}

func (a *API) runConversationReply(conversation *domain.Conversation, team *domain.AgentTeam, reply *domain.ConversationMessage, userContent string) {
	ctx, cancel := context.WithCancel(context.Background())
	a.conversationMu.Lock()
	if a.conversationReplies == nil {
		a.conversationReplies = map[string]context.CancelFunc{}
	}
	a.conversationReplies[reply.ID] = cancel
	a.conversationMu.Unlock()
	defer func() {
		cancel()
		a.conversationMu.Lock()
		delete(a.conversationReplies, reply.ID)
		a.conversationMu.Unlock()
	}()

	fail := func(code, message string) {
		reply.Status = domain.MessageStatusFailed
		reply.ErrorMessage = message
		_ = a.store.UpdateConversationMessage(context.Background(), reply)
		a.broadcast("conversation.reply.failed", map[string]any{
			"conversationId": conversation.ID, "messageId": reply.ID, "agentId": reply.AgentID,
			"error": message, "errorCode": code,
		})
	}

	agent, err := a.store.GetAgent(ctx, reply.AgentID)
	if err != nil {
		fail("AGENT_NOT_FOUND", "agent no longer exists")
		return
	}
	adapter, ok := a.registry.Get(agent.Runtime)
	if !ok {
		fail("RUNTIME_NOT_SUPPORTED", "agent runtime is not available")
		return
	}
	if prober, ok := adapter.(runtime.Prober); ok {
		probe := prober.Probe(ctx)
		if !probe.Compatible {
			fail("RUNTIME_UNSUPPORTED", probe.Detail)
			return
		}
	}
	workdir, err := os.MkdirTemp("", "ateam-conversation-*")
	if err != nil {
		fail("INTERNAL_ERROR", "cannot create the discussion draft directory")
		return
	}
	defer os.RemoveAll(workdir)

	messages, _ := a.store.ListConversationMessages(ctx, conversation.ID, 0, 20)
	prompt := conversationPrompt(team, agent, messages, userContent)
	var content strings.Builder
	usage := map[string]any{}
	runErr := adapter.Run(ctx, runtime.Request{
		Prompt:         prompt,
		Workdir:        workdir,
		Model:          agent.Model,
		PermissionMode: "read_only",
		Policy:         &runtime.Policy{},
	}, func(event runtime.Event) {
		switch event.Type {
		case "log":
			if event.Source != "stderr" && event.Source != "adapter" && event.Message != "" {
				if content.Len() > 0 && event.Data["delta"] != true {
					content.WriteString("\n")
				}
				content.WriteString(event.Message)
				a.broadcast("conversation.reply.delta", map[string]any{
					"conversationId": conversation.ID, "messageId": reply.ID, "agentId": reply.AgentID, "delta": event.Message,
				})
			}
		case "usage":
			for key, value := range event.Data {
				usage[key] = value
			}
		case "error":
			if reply.ErrorMessage == "" {
				reply.ErrorMessage = event.Message
			}
		}
	})
	reply.Content = content.String()
	reply.Usage = usage
	if ctx.Err() != nil {
		reply.Status = domain.MessageStatusCancelled
		_ = a.store.UpdateConversationMessage(context.Background(), reply)
		a.broadcast("conversation.reply.cancelled", map[string]any{
			"conversationId": conversation.ID, "messageId": reply.ID, "agentId": reply.AgentID,
		})
		return
	}
	if runErr != nil {
		if reply.ErrorMessage == "" {
			reply.ErrorMessage = runErr.Error()
		}
		fail("RUNTIME_ERROR", reply.ErrorMessage)
		return
	}
	reply.Status = domain.MessageStatusCompleted
	_ = a.store.UpdateConversationMessage(context.Background(), reply)
	a.broadcast("conversation.reply.completed", map[string]any{
		"conversationId": conversation.ID, "messageId": reply.ID, "agentId": reply.AgentID, "message": reply,
	})
}

func conversationPrompt(team *domain.AgentTeam, agent *domain.Agent, messages []domain.ConversationMessage, userContent string) string {
	var builder strings.Builder
	builder.WriteString("You are participating in a read-only discussion group in ATeam.\n")
	builder.WriteString("Do not write files, run commands, modify tasks, or create runs. Answer the user with discussion only.\n\n")
	builder.WriteString("Team: " + team.Name + "\n")
	if team.Description != "" {
		builder.WriteString("Team description: " + team.Description + "\n")
	}
	builder.WriteString("Your role: " + agent.Role + "\n")
	if agent.Instructions != "" {
		builder.WriteString("Instructions:\n" + agent.Instructions + "\n")
	}
	builder.WriteString("\nRecent conversation:\n")
	start := 0
	if len(messages) > 12 {
		start = len(messages) - 12
	}
	for _, message := range messages[start:] {
		if message.Status == domain.MessageStatusPending || message.Content == "" {
			continue
		}
		content := message.Content
		if len(content) > 2000 {
			content = content[:2000] + "…"
		}
		builder.WriteString(message.Role)
		if message.AgentID != "" {
			builder.WriteString(" (" + message.AgentID + ")")
		}
		builder.WriteString(": " + content + "\n")
	}
	builder.WriteString("\nUser: " + userContent + "\n")
	return builder.String()
}

func (a *API) convertMessageToTask(w http.ResponseWriter, r *http.Request) {
	message, err := a.store.GetConversationMessage(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	conversation, err := a.store.GetConversation(r.Context(), message.ConversationID)
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if existing, err := a.store.FindTaskByOriginMessage(r.Context(), message.ID); err == nil {
		if message.TaskID == "" {
			message.TaskID = existing.ID
			_ = a.store.UpdateConversationMessage(r.Context(), message)
		}
		a.writeJSON(w, http.StatusOK, map[string]any{"task": existing, "created": false})
		return
	} else if err != nil && !isNotFound(err) {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	var input convertMessageInput
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &input); err != nil {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
			return
		}
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = firstLine(message.Content)
	}
	if len(title) > 120 {
		title = title[:120]
	}
	description := strings.TrimSpace(input.Description)
	if description == "" {
		description = message.Content + "\n\nFrom conversation " + conversation.ID
	}
	task := &domain.Task{
		WorkspaceID:          conversation.WorkspaceID,
		Title:                title,
		Description:          description,
		Status:               domain.TaskBacklog,
		OriginConversationID: conversation.ID,
		OriginMessageID:      message.ID,
	}
	if err := a.store.CreateTask(r.Context(), task); err != nil {
		// A concurrent conversion may have won the unique origin index.
		if existing, findErr := a.store.FindTaskByOriginMessage(r.Context(), message.ID); findErr == nil {
			a.writeJSON(w, http.StatusOK, map[string]any{"task": existing, "created": false})
			return
		}
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	message.TaskID = task.ID
	_ = a.store.UpdateConversationMessage(r.Context(), message)
	system := &domain.ConversationMessage{
		ConversationID: conversation.ID,
		Role:           domain.MessageRoleSystem,
		Status:         domain.MessageStatusCompleted,
		Content:        "Task created: " + task.ID,
	}
	_ = a.store.AppendConversationMessage(r.Context(), system)
	a.broadcast("task.created", task)
	a.broadcast("conversation.message.created", system)
	a.broadcast("conversation.task_created", map[string]any{
		"conversationId": conversation.ID, "messageId": message.ID, "taskId": task.ID,
	})
	a.writeJSON(w, http.StatusOK, map[string]any{"task": task, "created": true})
}

func firstLine(value string) string {
	if index := strings.IndexByte(value, '\n'); index >= 0 {
		value = value[:index]
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "Task from conversation"
	}
	return value
}

func isNotFound(err error) bool {
	return errorsIs(err, store.ErrNotFound)
}

// errorsIs is a tiny indirection that keeps this file free of an extra
// import while matching wrapped store errors.
func errorsIs(err, target error) bool {
	for err != nil {
		if err == target {
			return true
		}
		unwrapper, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = unwrapper.Unwrap()
	}
	return false
}

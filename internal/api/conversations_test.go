package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
)

func decodeResponse(t *testing.T, recorder *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
		t.Fatalf("decode response: %v: %s", err, recorder.Body.String())
	}
}

func createConversationAgent(t *testing.T, st interface {
	CreateAgent(context.Context, *domain.Agent) error
}, name, role string) *domain.Agent {
	t.Helper()
	agent := &domain.Agent{
		Name: name, Role: role, Runtime: "mock", WorkspaceID: domain.DefaultWorkspaceID,
		PermissionMode: "read_only", MaxConcurrency: 1, TimeoutMinutes: 5,
	}
	if err := st.CreateAgent(context.Background(), agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	return agent
}

func createConversationTeam(t *testing.T, handler http.Handler, agents ...*domain.Agent) domain.AgentTeam {
	t.Helper()
	ids := make([]string, 0, len(agents))
	for _, agent := range agents {
		ids = append(ids, agent.ID)
	}
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agent-teams", map[string]any{
		"name": "Discussion", "memberAgentIds": ids,
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create team = %d: %s", recorder.Code, recorder.Body.String())
	}
	var team domain.AgentTeam
	decodeResponse(t, recorder, &team)
	return team
}

func createConversation(t *testing.T, handler http.Handler, teamID string) domain.Conversation {
	t.Helper()
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agent-teams/"+teamID+"/conversations", map[string]any{"title": "Chat"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create conversation = %d: %s", recorder.Code, recorder.Body.String())
	}
	var conversation domain.Conversation
	decodeResponse(t, recorder, &conversation)
	return conversation
}

func TestAgentTeamLifecycle(t *testing.T) {
	handler, st := newTestHandler(t)
	frontend := createConversationAgent(t, st, "Frontend", domain.AgentRoleFrontend)
	backend := createConversationAgent(t, st, "Backend", domain.AgentRoleBackend)
	team := createConversationTeam(t, handler, frontend, backend)
	if len(team.Members) != 2 {
		t.Fatalf("members = %#v", team.Members)
	}

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agent-teams/"+team.ID+"/members", map[string]any{"agentId": frontend.ID})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("duplicate member = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/agent-teams/"+team.ID, map[string]any{
		"name": "Renamed", "expectedRevision": 1,
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("patch team = %d: %s", recorder.Code, recorder.Body.String())
	}
	var renamed domain.AgentTeam
	decodeResponse(t, recorder, &renamed)
	if renamed.Name != "Renamed" || renamed.Revision != 2 {
		t.Fatalf("renamed = %#v", renamed)
	}
	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/agent-teams/"+team.ID, map[string]any{
		"name": "Stale", "expectedRevision": 1,
	})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("stale patch = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/agent-teams/"+team.ID+"/archive", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("archive = %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/agent-teams/"+team.ID+"/conversations", map[string]any{})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("conversation on archived team = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestConversationRoutingReplyAndConvert(t *testing.T) {
	handler, st := newTestHandler(t)
	frontend := createConversationAgent(t, st, "Frontend", domain.AgentRoleFrontend)
	team := createConversationTeam(t, handler, frontend)
	conversation := createConversation(t, handler, team.ID)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/conversations/"+conversation.ID+"/messages", map[string]any{
		"content": "hello group",
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("send = %d: %s", recorder.Code, recorder.Body.String())
	}
	var sent struct {
		Message        domain.ConversationMessage         `json:"message"`
		ReplyMessageID string                             `json:"replyMessageId"`
		Routing        domain.ConversationRoutingDecision `json:"routing"`
	}
	decodeResponse(t, recorder, &sent)
	if sent.ReplyMessageID == "" || sent.Routing.SelectedAgentID != frontend.ID {
		t.Fatalf("sent = %#v", sent)
	}

	deadline := time.Now().Add(8 * time.Second)
	var reply *domain.ConversationMessage
	for time.Now().Before(deadline) {
		reply, _ = st.GetConversationMessage(context.Background(), sent.ReplyMessageID)
		if reply != nil && reply.Status != domain.MessageStatusPending {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if reply == nil || reply.Status != domain.MessageStatusCompleted {
		t.Fatalf("reply = %#v", reply)
	}
	if reply.Content == "" {
		t.Fatalf("reply content is empty")
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/conversations/"+conversation.ID+"/messages?afterSeq=0&limit=10", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("messages = %d: %s", recorder.Code, recorder.Body.String())
	}
	var list struct {
		Messages []domain.ConversationMessage `json:"messages"`
	}
	decodeResponse(t, recorder, &list)
	if len(list.Messages) < 2 || list.Messages[0].Seq >= list.Messages[1].Seq {
		t.Fatalf("messages = %#v", list.Messages)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/messages/"+sent.Message.ID+"/convert-to-task", map[string]any{})
	if recorder.Code != http.StatusOK {
		t.Fatalf("convert = %d: %s", recorder.Code, recorder.Body.String())
	}
	var converted struct {
		Task    domain.Task `json:"task"`
		Created bool        `json:"created"`
	}
	decodeResponse(t, recorder, &converted)
	if !converted.Created || converted.Task.Status != domain.TaskBacklog {
		t.Fatalf("converted = %#v", converted)
	}
	if converted.Task.OriginConversationID != conversation.ID || converted.Task.OriginMessageID != sent.Message.ID {
		t.Fatalf("origin = %#v", converted.Task)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/messages/"+sent.Message.ID+"/convert-to-task", map[string]any{})
	decodeResponse(t, recorder, &converted)
	if converted.Created {
		t.Fatalf("second conversion must be idempotent: %#v", converted)
	}
}

func TestConversationMentionAndRoutingErrors(t *testing.T) {
	handler, st := newTestHandler(t)
	frontend := createConversationAgent(t, st, "Frontend", domain.AgentRoleFrontend)
	backend := createConversationAgent(t, st, "Backend", domain.AgentRoleBackend)
	team := createConversationTeam(t, handler, frontend, backend)
	conversation := createConversation(t, handler, team.ID)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/conversations/"+conversation.ID+"/messages", map[string]any{
		"content": "please review @Frontend", "mentions": []string{frontend.ID},
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("mention send = %d: %s", recorder.Code, recorder.Body.String())
	}
	var sent struct {
		Routing domain.ConversationRoutingDecision `json:"routing"`
	}
	decodeResponse(t, recorder, &sent)
	if sent.Routing.Mode != domain.RoutingModeMention || sent.Routing.SelectedAgentID != frontend.ID {
		t.Fatalf("routing = %#v", sent.Routing)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/conversations/"+conversation.ID+"/messages", map[string]any{
		"content": "hello",
	})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("ambiguous routing = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/conversations/"+conversation.ID+"/messages", map[string]any{
		"content": "@Backend hi", "mentions": []string{frontend.ID},
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("mismatched mention = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestConversationArchiveAndCancel(t *testing.T) {
	handler, st := newTestHandler(t)
	frontend := createConversationAgent(t, st, "Frontend", domain.AgentRoleFrontend)
	team := createConversationTeam(t, handler, frontend)
	conversation := createConversation(t, handler, team.ID)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/conversations/"+conversation.ID+"/messages", map[string]any{
		"content": "long discussion",
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("send = %d: %s", recorder.Code, recorder.Body.String())
	}
	var sent struct {
		ReplyMessageID string `json:"replyMessageId"`
	}
	decodeResponse(t, recorder, &sent)
	cancelled := false
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		recorder = callJSON(t, handler, http.MethodPost, "/api/v1/conversations/"+conversation.ID+"/messages/"+sent.ReplyMessageID+"/cancel", map[string]any{})
		if recorder.Code == http.StatusOK {
			cancelled = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !cancelled {
		t.Fatalf("cancel reply = %d: %s", recorder.Code, recorder.Body.String())
	}
	reply, _ := st.GetConversationMessage(context.Background(), sent.ReplyMessageID)
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && reply.Status == domain.MessageStatusPending {
		time.Sleep(50 * time.Millisecond)
		reply, _ = st.GetConversationMessage(context.Background(), sent.ReplyMessageID)
	}
	if reply == nil || reply.Status != domain.MessageStatusCancelled {
		t.Fatalf("reply after cancel = %#v", reply)
	}

	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/conversations/"+conversation.ID, map[string]any{"status": domain.ConversationArchived})
	if recorder.Code != http.StatusOK {
		t.Fatalf("archive conversation = %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/conversations/"+conversation.ID+"/messages", map[string]any{"content": "after archive"})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("send after archive = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestTeamMemberWorkspaceValidation(t *testing.T) {
	handler, st := newTestHandler(t)
	local := createConversationAgent(t, st, "Local", domain.AgentRoleFrontend)
	foreign := &domain.Agent{Name: "Foreign", Role: domain.AgentRoleBackend, Runtime: "mock", WorkspaceID: "other"}
	if err := st.CreateAgent(context.Background(), foreign); err != nil {
		t.Fatalf("create foreign agent: %v", err)
	}
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agent-teams", map[string]any{
		"name": "Mixed", "memberAgentIds": []string{local.ID, foreign.ID},
	})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("cross-workspace team = %d: %s", recorder.Code, recorder.Body.String())
	}
}

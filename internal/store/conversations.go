package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
)

const teamColumns = `id, workspace_id, name, description, status, revision, created_at, updated_at, archived_at`
const conversationColumns = `id, team_id, workspace_id, title, status, revision, last_message_at, created_at, updated_at, archived_at`
const messageColumns = `id, conversation_id, seq, role, agent_id, status, content, error_message, usage, routing, reply_to_id, task_id, created_at, updated_at`

func scanTeam(s scanner) (*domain.AgentTeam, error) {
	var (
		team     domain.AgentTeam
		created  int64
		updated  int64
		archived sql.NullInt64
	)
	if err := s.Scan(&team.ID, &team.WorkspaceID, &team.Name, &team.Description, &team.Status, &team.Revision, &created, &updated, &archived); err != nil {
		return nil, err
	}
	team.CreatedAt = timeFromMillis(created)
	team.UpdatedAt = timeFromMillis(updated)
	team.ArchivedAt = timePtrFromNull(archived)
	return &team, nil
}

func (s *SQLite) CreateAgentTeam(ctx context.Context, team *domain.AgentTeam) error {
	if team.ID == "" {
		team.ID = domain.NewID()
	}
	if team.WorkspaceID == "" {
		team.WorkspaceID = domain.DefaultWorkspaceID
	}
	if team.Status == "" {
		team.Status = domain.AgentTeamActive
	}
	if team.Revision == 0 {
		team.Revision = 1
	}
	now := domain.Now()
	if team.CreatedAt.IsZero() {
		team.CreatedAt = now
	}
	team.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `INSERT INTO agent_teams (`+teamColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		team.ID, team.WorkspaceID, team.Name, team.Description, team.Status, team.Revision,
		millis(team.CreatedAt), millis(team.UpdatedAt), nullMillis(team.ArchivedAt))
	if err != nil {
		return fmt.Errorf("create agent team: %w", err)
	}
	return nil
}

func (s *SQLite) ListAgentTeams(ctx context.Context, workspaceID, status string, limit, offset int) ([]domain.AgentTeam, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	query := `SELECT ` + teamColumns + ` FROM agent_teams WHERE 1 = 1`
	args := []any{}
	if workspaceID != "" {
		query += ` AND workspace_id = ?`
		args = append(args, workspaceID)
	}
	if status != "" {
		query += ` AND status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list agent teams: %w", err)
	}
	defer rows.Close()
	teams := []domain.AgentTeam{}
	for rows.Next() {
		team, err := scanTeam(rows)
		if err != nil {
			return nil, fmt.Errorf("scan agent team: %w", err)
		}
		teams = append(teams, *team)
	}
	return teams, rows.Err()
}

func (s *SQLite) GetAgentTeam(ctx context.Context, id string) (*domain.AgentTeam, error) {
	team, err := scanTeam(s.db.QueryRowContext(ctx, `SELECT `+teamColumns+` FROM agent_teams WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("agent team %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("get agent team: %w", err)
	}
	return team, nil
}

func (s *SQLite) UpdateAgentTeam(ctx context.Context, team *domain.AgentTeam, expectedRevision int) (bool, error) {
	query := `UPDATE agent_teams SET name = ?, description = ?, revision = revision + 1, updated_at = ? WHERE id = ?`
	args := []any{team.Name, team.Description, millis(domain.Now()), team.ID}
	if expectedRevision > 0 {
		query += ` AND revision = ?`
		args = append(args, expectedRevision)
	}
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return false, fmt.Errorf("update agent team: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if affected > 0 {
		team.Revision++
	}
	return affected > 0, nil
}

func (s *SQLite) ArchiveAgentTeam(ctx context.Context, id string) error {
	now := domain.Now()
	result, err := s.db.ExecContext(ctx, `UPDATE agent_teams SET status = ?, revision = revision + 1, archived_at = ?, updated_at = ? WHERE id = ?`,
		domain.AgentTeamArchived, millis(now), millis(now), id)
	if err != nil {
		return fmt.Errorf("archive agent team: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return fmt.Errorf("agent team %s: %w", id, ErrNotFound)
	}
	return nil
}

func (s *SQLite) AddAgentTeamMember(ctx context.Context, teamID string, member domain.AgentTeamMember) error {
	if member.JoinedAt.IsZero() {
		member.JoinedAt = domain.Now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO agent_team_members (team_id, agent_id, role_override, position, joined_at) VALUES (?, ?, ?, ?, ?)`,
		teamID, member.AgentID, member.RoleOverride, member.Position, millis(member.JoinedAt))
	if err != nil {
		return fmt.Errorf("add agent team member: %w", err)
	}
	return nil
}

func (s *SQLite) RemoveAgentTeamMember(ctx context.Context, teamID, agentID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM agent_team_members WHERE team_id = ? AND agent_id = ?`, teamID, agentID)
	if err != nil {
		return fmt.Errorf("remove agent team member: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return fmt.Errorf("agent team member %s: %w", agentID, ErrNotFound)
	}
	return nil
}

func (s *SQLite) ListAgentTeamMembers(ctx context.Context, teamID string) ([]domain.AgentTeamMember, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT m.agent_id, a.name, a.role, m.role_override, m.position, m.joined_at
		FROM agent_team_members m JOIN agents a ON a.id = m.agent_id
		WHERE m.team_id = ? ORDER BY m.position ASC, m.joined_at ASC`, teamID)
	if err != nil {
		return nil, fmt.Errorf("list agent team members: %w", err)
	}
	defer rows.Close()
	members := []domain.AgentTeamMember{}
	for rows.Next() {
		var (
			member domain.AgentTeamMember
			joined int64
		)
		if err := rows.Scan(&member.AgentID, &member.Name, &member.Role, &member.RoleOverride, &member.Position, &joined); err != nil {
			return nil, fmt.Errorf("scan agent team member: %w", err)
		}
		member.JoinedAt = timeFromMillis(joined)
		members = append(members, member)
	}
	return members, rows.Err()
}

func scanConversation(s scanner) (*domain.Conversation, error) {
	var (
		conversation domain.Conversation
		lastMessage  sql.NullInt64
		created      int64
		updated      int64
		archived     sql.NullInt64
	)
	if err := s.Scan(&conversation.ID, &conversation.TeamID, &conversation.WorkspaceID, &conversation.Title,
		&conversation.Status, &conversation.Revision, &lastMessage, &created, &updated, &archived); err != nil {
		return nil, err
	}
	conversation.LastMessageAt = timePtrFromNull(lastMessage)
	conversation.CreatedAt = timeFromMillis(created)
	conversation.UpdatedAt = timeFromMillis(updated)
	conversation.ArchivedAt = timePtrFromNull(archived)
	return &conversation, nil
}

func (s *SQLite) CreateConversation(ctx context.Context, conversation *domain.Conversation) error {
	if conversation.ID == "" {
		conversation.ID = domain.NewID()
	}
	if conversation.WorkspaceID == "" {
		conversation.WorkspaceID = domain.DefaultWorkspaceID
	}
	if conversation.Status == "" {
		conversation.Status = domain.ConversationActive
	}
	if conversation.Revision == 0 {
		conversation.Revision = 1
	}
	now := domain.Now()
	if conversation.CreatedAt.IsZero() {
		conversation.CreatedAt = now
	}
	conversation.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `INSERT INTO conversations (`+conversationColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		conversation.ID, conversation.TeamID, conversation.WorkspaceID, conversation.Title, conversation.Status,
		conversation.Revision, nullMillis(conversation.LastMessageAt), millis(conversation.CreatedAt),
		millis(conversation.UpdatedAt), nullMillis(conversation.ArchivedAt))
	if err != nil {
		return fmt.Errorf("create conversation: %w", err)
	}
	return nil
}

func (s *SQLite) ListConversations(ctx context.Context, teamID, status string, limit, offset int) ([]domain.Conversation, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	query := `SELECT ` + conversationColumns + ` FROM conversations WHERE team_id = ?`
	args := []any{teamID}
	if status != "" {
		query += ` AND status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer rows.Close()
	items := []domain.Conversation{}
	for rows.Next() {
		conversation, err := scanConversation(rows)
		if err != nil {
			return nil, fmt.Errorf("scan conversation: %w", err)
		}
		items = append(items, *conversation)
	}
	return items, rows.Err()
}

func (s *SQLite) GetConversation(ctx context.Context, id string) (*domain.Conversation, error) {
	conversation, err := scanConversation(s.db.QueryRowContext(ctx, `SELECT `+conversationColumns+` FROM conversations WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("conversation %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("get conversation: %w", err)
	}
	return conversation, nil
}

func (s *SQLite) UpdateConversation(ctx context.Context, conversation *domain.Conversation, expectedRevision int) (bool, error) {
	now := domain.Now()
	query := `UPDATE conversations SET title = ?, status = ?, revision = revision + 1, updated_at = ?, archived_at = ? WHERE id = ?`
	args := []any{conversation.Title, conversation.Status, millis(now), nullMillis(conversation.ArchivedAt), conversation.ID}
	if expectedRevision > 0 {
		query += ` AND revision = ?`
		args = append(args, expectedRevision)
	}
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return false, fmt.Errorf("update conversation: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected > 0 {
		conversation.Revision++
		conversation.UpdatedAt = now
	}
	return affected > 0, nil
}

func (s *SQLite) AppendConversationMessage(ctx context.Context, message *domain.ConversationMessage) error {
	if message.ID == "" {
		message.ID = domain.NewID()
	}
	if message.Status == "" {
		message.Status = domain.MessageStatusCompleted
	}
	if message.Usage == nil {
		message.Usage = map[string]any{}
	}
	now := domain.Now()
	if message.CreatedAt.IsZero() {
		message.CreatedAt = now
	}
	message.UpdatedAt = now

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("append message: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq), 0) FROM conversation_messages WHERE conversation_id = ?`, message.ConversationID).Scan(&message.Seq); err != nil {
		return fmt.Errorf("next message seq: %w", err)
	}
	message.Seq++
	routing := "{}"
	if message.Routing != nil {
		encoded, err := json.Marshal(message.Routing)
		if err != nil {
			return err
		}
		routing = string(encoded)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO conversation_messages (`+messageColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		message.ID, message.ConversationID, message.Seq, message.Role, message.AgentID, message.Status, message.Content,
		message.ErrorMessage, mustJSON(message.Usage), routing, message.ReplyToID, message.TaskID,
		millis(message.CreatedAt), millis(message.UpdatedAt))
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?`,
		millis(now), millis(now), message.ConversationID); err != nil {
		return fmt.Errorf("touch conversation: %w", err)
	}
	return tx.Commit()
}

func scanMessage(s scanner) (*domain.ConversationMessage, error) {
	var (
		message domain.ConversationMessage
		usage   string
		routing string
		created int64
		updated int64
	)
	if err := s.Scan(&message.ID, &message.ConversationID, &message.Seq, &message.Role, &message.AgentID,
		&message.Status, &message.Content, &message.ErrorMessage, &usage, &routing, &message.ReplyToID,
		&message.TaskID, &created, &updated); err != nil {
		return nil, err
	}
	message.Usage = jsonMap(usage)
	message.Routing = decodeRouting(routing)
	message.CreatedAt = timeFromMillis(created)
	message.UpdatedAt = timeFromMillis(updated)
	return &message, nil
}

func (s *SQLite) ListConversationMessages(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]domain.ConversationMessage, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+messageColumns+` FROM conversation_messages
		WHERE conversation_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`, conversationID, afterSeq, limit)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()
	messages := []domain.ConversationMessage{}
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, *message)
	}
	return messages, rows.Err()
}

func (s *SQLite) GetConversationMessage(ctx context.Context, id string) (*domain.ConversationMessage, error) {
	message, err := scanMessage(s.db.QueryRowContext(ctx, `SELECT `+messageColumns+` FROM conversation_messages WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("message %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	return message, nil
}

func (s *SQLite) UpdateConversationMessage(ctx context.Context, message *domain.ConversationMessage) error {
	if message.Usage == nil {
		message.Usage = map[string]any{}
	}
	routing := "{}"
	if message.Routing != nil {
		encoded, err := json.Marshal(message.Routing)
		if err != nil {
			return err
		}
		routing = string(encoded)
	}
	message.UpdatedAt = domain.Now()
	result, err := s.db.ExecContext(ctx, `UPDATE conversation_messages
		SET status = ?, content = ?, error_message = ?, usage = ?, routing = ?, reply_to_id = ?, task_id = ?, updated_at = ?
		WHERE id = ?`, message.Status, message.Content, message.ErrorMessage, mustJSON(message.Usage), routing,
		message.ReplyToID, message.TaskID, millis(message.UpdatedAt), message.ID)
	if err != nil {
		return fmt.Errorf("update message: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return fmt.Errorf("message %s: %w", message.ID, ErrNotFound)
	}
	return nil
}

func (s *SQLite) CreateRoutingDecision(ctx context.Context, decision *domain.ConversationRoutingDecision) error {
	if decision.ID == "" {
		decision.ID = domain.NewID()
	}
	if decision.CreatedAt.IsZero() {
		decision.CreatedAt = domain.Now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO conversation_routing_decisions
		(id, conversation_id, message_id, mode, source, candidates, selected_agent_id, rationale, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		decision.ID, decision.ConversationID, decision.MessageID, decision.Mode, decision.Source,
		mustJSON(decision.Candidates), decision.SelectedAgentID, decision.Rationale, millis(decision.CreatedAt))
	if err != nil {
		return fmt.Errorf("create routing decision: %w", err)
	}
	return nil
}

func (s *SQLite) GetRoutingDecisionForMessage(ctx context.Context, messageID string) (*domain.ConversationRoutingDecision, error) {
	var (
		decision   domain.ConversationRoutingDecision
		candidates string
		created    int64
	)
	err := s.db.QueryRowContext(ctx, `SELECT id, conversation_id, message_id, mode, source, candidates, selected_agent_id, rationale, created_at
		FROM conversation_routing_decisions WHERE message_id = ? ORDER BY created_at DESC LIMIT 1`, messageID).Scan(
		&decision.ID, &decision.ConversationID, &decision.MessageID, &decision.Mode, &decision.Source,
		&candidates, &decision.SelectedAgentID, &decision.Rationale, &created)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("routing decision %s: %w", messageID, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("get routing decision: %w", err)
	}
	decision.Candidates = decodeCandidates(candidates)
	decision.CreatedAt = timeFromMillis(created)
	return &decision, nil
}

func (s *SQLite) FindTaskByOriginMessage(ctx context.Context, messageID string) (*domain.Task, error) {
	task, err := scanTask(s.db.QueryRowContext(ctx, `SELECT `+taskColumns+` FROM tasks WHERE origin_message_id = ? LIMIT 1`, messageID))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("task from message %s: %w", messageID, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("find task by origin message: %w", err)
	}
	return task, nil
}

func timePtrFromNull(value sql.NullInt64) *time.Time {
	if !value.Valid {
		return nil
	}
	t := timeFromMillis(value.Int64)
	return &t
}

func nullMillis(value *time.Time) any {
	if value == nil {
		return nil
	}
	return millis(*value)
}

func decodeRouting(raw string) *domain.ConversationRoutingDecision {
	if raw == "" || raw == "{}" || raw == "null" {
		return nil
	}
	var decision domain.ConversationRoutingDecision
	if err := json.Unmarshal([]byte(raw), &decision); err != nil {
		return nil
	}
	return &decision
}

func decodeCandidates(raw string) []domain.RoutingCandidate {
	result := []domain.RoutingCandidate{}
	if raw == "" {
		return result
	}
	_ = json.Unmarshal([]byte(raw), &result)
	return result
}

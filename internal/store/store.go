package store

import (
	"context"
	"errors"

	"github.com/lxqddd/ATeam/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Store interface {
	CreateWorkspace(context.Context, *domain.Workspace) error
	ListWorkspaces(context.Context) ([]domain.Workspace, error)
	GetWorkspace(context.Context, string) (*domain.Workspace, error)
	UpdateWorkspace(context.Context, *domain.Workspace) error
	// HasActiveRunsByWorkspace reports whether a queued/preparing/running Run
	// belongs to the workspace; repoPath/defaultBranch changes are blocked
	// while true.
	HasActiveRunsByWorkspace(context.Context, string) (bool, error)

	CreateTask(context.Context, *domain.Task) error
	ListTasks(context.Context) ([]domain.Task, error)
	GetTask(context.Context, string) (*domain.Task, error)
	UpdateTask(context.Context, *domain.Task) error
	DeleteTask(context.Context, string) error

	// Task dependency DAG (M2.1): replace-all outgoing edges per task,
	// plus lookups for readiness and cycle detection.
	ReplaceTaskDependencies(context.Context, string, []domain.TaskDependency) error
	ListOutgoingDependencies(context.Context, string) ([]domain.TaskDependency, error)
	ListIncomingDependencies(context.Context, string) ([]domain.TaskDependency, error)
	HasDependencyEdge(context.Context, string, string) (bool, error)

	CreateAgent(context.Context, *domain.Agent) error
	ListAgents(context.Context) ([]domain.Agent, error)
	GetAgent(context.Context, string) (*domain.Agent, error)
	UpdateAgent(context.Context, *domain.Agent) error
	DeleteAgent(context.Context, string) error

	// Runtime model configuration is local to the installation: it holds
	// model IDs the user added for a runtime that the CLI cannot enumerate.
	GetRuntimeModelConfig(context.Context, string) (*domain.RuntimeModelConfig, error)
	SetRuntimeModelConfig(context.Context, string, []domain.RuntimeModel, string) (*domain.RuntimeModelConfig, error)

	// M2.3 Agent teams and conversations.
	CreateAgentTeam(context.Context, *domain.AgentTeam) error
	ListAgentTeams(context.Context, string, string, int, int) ([]domain.AgentTeam, error)
	GetAgentTeam(context.Context, string) (*domain.AgentTeam, error)
	UpdateAgentTeam(context.Context, *domain.AgentTeam, int) (bool, error)
	ArchiveAgentTeam(context.Context, string) error
	AddAgentTeamMember(context.Context, string, domain.AgentTeamMember) error
	RemoveAgentTeamMember(context.Context, string, string) error
	ListAgentTeamMembers(context.Context, string) ([]domain.AgentTeamMember, error)

	CreateConversation(context.Context, *domain.Conversation) error
	ListConversations(context.Context, string, string, int, int) ([]domain.Conversation, error)
	GetConversation(context.Context, string) (*domain.Conversation, error)
	UpdateConversation(context.Context, *domain.Conversation, int) (bool, error)

	AppendConversationMessage(context.Context, *domain.ConversationMessage) error
	ListConversationMessages(context.Context, string, int64, int) ([]domain.ConversationMessage, error)
	GetConversationMessage(context.Context, string) (*domain.ConversationMessage, error)
	UpdateConversationMessage(context.Context, *domain.ConversationMessage) error

	CreateRoutingDecision(context.Context, *domain.ConversationRoutingDecision) error
	GetRoutingDecisionForMessage(context.Context, string) (*domain.ConversationRoutingDecision, error)

	FindTaskByOriginMessage(context.Context, string) (*domain.Task, error)

	CreateRun(context.Context, *domain.Run) error
	ListRuns(context.Context) ([]domain.Run, error)
	ListRunsByTask(context.Context, string) ([]domain.Run, error)
	// ListRunsByAgent returns the agent's most recent runs, newest first,
	// capped at limit (work page history, PRD api-and-data §5.16).
	ListRunsByAgent(context.Context, string, int) ([]domain.Run, error)
	// CountActiveRunsByAgent reports queued/preparing/running runs for the
	// agent (work page "working" state includes queued).
	CountActiveRunsByAgent(context.Context, string) (int, error)
	GetRun(context.Context, string) (*domain.Run, error)
	UpdateRun(context.Context, *domain.Run) error
	// UpdateRunIfActive writes the run only while the stored status is still
	// queued/preparing/running. It reports false when the run already reached
	// a terminal state (for example a concurrent cancel), so callers never
	// resurrect a cancelled run.
	UpdateRunIfActive(context.Context, *domain.Run) (bool, error)
	// MarkRunCancelRequested records cancel_requested_at for an active run
	// without touching the other columns, so worker writes cannot clear it.
	MarkRunCancelRequested(context.Context, string) (bool, error)
	// SetRunRuntimeSessionID records the harness session/thread id once the
	// runtime reports it, so a Run detail can link back to the CLI session.
	SetRunRuntimeSessionID(context.Context, string, string) error
	// SetRunQueueReason records why a queued run is waiting (per-agent
	// concurrency) without changing its status.
	SetRunQueueReason(context.Context, string, string) (bool, error)

	CreateRunConfigSnapshot(context.Context, *domain.RunConfigSnapshot) error
	GetRunConfigSnapshotByRun(context.Context, string) (*domain.RunConfigSnapshot, error)

	CreateArtifact(context.Context, *domain.Artifact) error
	GetArtifact(context.Context, string) (*domain.Artifact, error)
	ListArtifactsByRun(context.Context, string) ([]domain.Artifact, error)
	ListArtifactsByTask(context.Context, string) ([]domain.Artifact, error)
	FindArtifactBySHA(context.Context, string) (*domain.Artifact, error)

	CreateReview(context.Context, *domain.Review) error
	GetReview(context.Context, string) (*domain.Review, error)
	ListReviewsByRun(context.Context, string) ([]domain.Review, error)
	UpdateReviewIfStatus(context.Context, *domain.Review, string) (bool, error)
	CreateReviewComment(context.Context, *domain.ReviewComment) error
	ListReviewComments(context.Context, string) ([]domain.ReviewComment, error)
	ResolveReviewComment(context.Context, string) (*domain.ReviewComment, error)
	CreateMergeRecord(context.Context, *domain.MergeRecord) error
	GetMergeRecordByRun(context.Context, string) (*domain.MergeRecord, error)

	AppendRunEvent(context.Context, *domain.RunEvent) error
	ListRunEvents(context.Context, string) ([]domain.RunEvent, error)

	Close() error
}

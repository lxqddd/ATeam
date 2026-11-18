package store

import (
	"context"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
)

func openTestStore(t *testing.T) *SQLite {
	t.Helper()
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestWorkspaceCRUD(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	workspace := &domain.Workspace{
		Name:          "Demo",
		RepoPath:      "/tmp/demo",
		DefaultBranch: "main",
		Settings:      domain.WorkspaceSettings{Remote: "origin", VerificationCommands: []string{"make test"}},
	}
	if err := st.CreateWorkspace(ctx, workspace); err != nil {
		t.Fatalf("create: %v", err)
	}
	if workspace.ID == "" || workspace.Status != domain.WorkspaceActive {
		t.Fatalf("defaults missing: %#v", workspace)
	}
	listed, err := st.ListWorkspaces(ctx)
	if err != nil || len(listed) != 2 { // default + demo
		t.Fatalf("list = %d err=%v", len(listed), err)
	}
	loaded, err := st.GetWorkspace(ctx, workspace.ID)
	if err != nil || loaded.Settings.Remote != "origin" || len(loaded.Settings.VerificationCommands) != 1 {
		t.Fatalf("get: %#v err=%v", loaded, err)
	}

	archived := domain.Now()
	loaded.Name = "Renamed"
	loaded.ArchivedAt = &archived
	if err := st.UpdateWorkspace(ctx, loaded); err != nil {
		t.Fatalf("update: %v", err)
	}
	updated, _ := st.GetWorkspace(ctx, workspace.ID)
	if updated.Name != "Renamed" || updated.ArchivedAt == nil {
		t.Fatalf("update not persisted: %#v", updated)
	}

	if _, err := st.GetWorkspace(ctx, "missing"); err == nil {
		t.Fatal("expected not found")
	}
	if err := st.UpdateWorkspace(ctx, &domain.Workspace{ID: "missing"}); err == nil {
		t.Fatal("expected update not found")
	}
}

func TestHasActiveRunsByWorkspace(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	task := &domain.Task{Title: "T", Status: domain.TaskTodo}
	_ = st.CreateTask(ctx, task)
	agent := &domain.Agent{Name: "A"}
	_ = st.CreateAgent(ctx, agent)
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunQueued, Trigger: "manual"}
	_ = st.CreateRun(ctx, run)

	active, err := st.HasActiveRunsByWorkspace(ctx, domain.DefaultWorkspaceID)
	if err != nil || !active {
		t.Fatalf("active = %v err=%v", active, err)
	}
	run.Status = domain.RunCompleted
	_ = st.UpdateRun(ctx, run)
	active, _ = st.HasActiveRunsByWorkspace(ctx, domain.DefaultWorkspaceID)
	if active {
		t.Fatal("completed run must not count as active")
	}
}

func TestArtifactStore(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	record := &domain.Artifact{
		WorkspaceID: "default", TaskID: "task-1", RunID: "run-1",
		Type: domain.ArtifactDiff, Name: "run.diff", MediaType: "text/plain",
		SizeBytes: 10, SHA256: "abc", StoragePath: "/tmp/file",
		Origin: domain.ArtifactOriginSystemCollected, Truncated: true,
		RedactionState: domain.RedactionRedacted,
	}
	if err := st.CreateArtifact(ctx, record); err != nil {
		t.Fatalf("create: %v", err)
	}
	if record.ID == "" || record.CreatedAt.IsZero() {
		t.Fatal("defaults missing")
	}
	loaded, err := st.GetArtifact(ctx, record.ID)
	if err != nil || !loaded.Truncated || loaded.RedactionState != domain.RedactionRedacted || loaded.StoragePath != "/tmp/file" {
		t.Fatalf("get: %#v err=%v", loaded, err)
	}
	byRun, _ := st.ListArtifactsByRun(ctx, "run-1")
	if len(byRun) != 1 {
		t.Fatalf("list run = %d", len(byRun))
	}
	byTask, _ := st.ListArtifactsByTask(ctx, "task-1")
	if len(byTask) != 1 {
		t.Fatalf("list task = %d", len(byTask))
	}
	bySHA, err := st.FindArtifactBySHA(ctx, "abc")
	if err != nil || bySHA.ID != record.ID {
		t.Fatalf("find sha: %#v err=%v", bySHA, err)
	}
	if _, err := st.FindArtifactBySHA(ctx, "missing"); err == nil {
		t.Fatal("expected sha miss")
	}
	if _, err := st.GetArtifact(ctx, "missing"); err == nil {
		t.Fatal("expected artifact miss")
	}
}

func TestReviewStoreLifecycle(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	review := &domain.Review{
		WorkspaceID: "default", TaskID: "task-1", RunID: "run-1",
		Status: domain.ReviewPending, RequestedBy: "local", EvidenceSnapshotHash: "hash",
		RequiresMerge: true,
	}
	if err := st.CreateReview(ctx, review); err != nil {
		t.Fatalf("create: %v", err)
	}
	if review.ID == "" || review.Revision != 1 {
		t.Fatalf("defaults missing: %#v", review)
	}
	loaded, err := st.GetReview(ctx, review.ID)
	if err != nil || loaded.Status != domain.ReviewPending {
		t.Fatalf("get: %#v err=%v", loaded, err)
	}
	listed, _ := st.ListReviewsByRun(ctx, "run-1")
	if len(listed) != 1 {
		t.Fatalf("list = %d", len(listed))
	}

	now := domain.Now()
	review.Status = domain.ReviewApproved
	review.DecisionNote = "ok"
	review.DecidedAt = &now
	updated, err := st.UpdateReviewIfStatus(ctx, review, domain.ReviewPending)
	if err != nil || !updated || review.Revision != 2 {
		t.Fatalf("update: %v %v rev=%d", updated, err, review.Revision)
	}
	if again, _ := st.UpdateReviewIfStatus(ctx, review, domain.ReviewPending); again {
		t.Fatal("stale expected status must fail")
	}

	line := 12
	comment := &domain.ReviewComment{ReviewID: review.ID, FilePath: "a.ts", Line: &line, Severity: "blocking", Body: "fix"}
	if err := st.CreateReviewComment(ctx, comment); err != nil {
		t.Fatalf("create comment: %v", err)
	}
	comments, _ := st.ListReviewComments(ctx, review.ID)
	if len(comments) != 1 || comments[0].Line == nil || *comments[0].Line != 12 {
		t.Fatalf("comments: %#v", comments)
	}
	resolved, err := st.ResolveReviewComment(ctx, comment.ID)
	if err != nil || resolved.ResolvedAt == nil {
		t.Fatalf("resolve: %#v err=%v", resolved, err)
	}
	if _, err := st.ResolveReviewComment(ctx, "missing"); err == nil {
		t.Fatal("expected resolve miss")
	}

	mergeRecord := &domain.MergeRecord{WorkspaceID: "default", RunID: "run-1", ReviewID: review.ID, TargetBranch: "main", SourceBranch: "run", Strategy: "squash", Commit: "abc", Operator: "local", Result: "merged"}
	if err := st.CreateMergeRecord(ctx, mergeRecord); err != nil {
		t.Fatalf("merge record: %v", err)
	}
	gotRecord, err := st.GetMergeRecordByRun(ctx, "run-1")
	if err != nil || gotRecord.Commit != "abc" {
		t.Fatalf("get merge record: %#v err=%v", gotRecord, err)
	}
	if _, err := st.GetMergeRecordByRun(ctx, "missing"); err == nil {
		t.Fatal("expected merge record miss")
	}
	if _, err := st.GetReview(ctx, "missing"); err == nil {
		t.Fatal("expected review miss")
	}
}

func TestRunConfigSnapshotStore(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	snapshot := &domain.RunConfigSnapshot{RunID: "run-1", ConfigSnapshot: "{}", PromptHash: "hash", RuntimeVersion: "1.2.3", PermissionMode: "controlled_edit", PermissionEnvelope: "{}"}
	if err := st.CreateRunConfigSnapshot(ctx, snapshot); err != nil {
		t.Fatalf("create: %v", err)
	}
	if snapshot.ID == "" {
		t.Fatal("expected id")
	}
	loaded, err := st.GetRunConfigSnapshotByRun(ctx, "run-1")
	if err != nil || loaded.RuntimeVersion != "1.2.3" {
		t.Fatalf("get: %#v err=%v", loaded, err)
	}
	if err := st.CreateRunConfigSnapshot(ctx, &domain.RunConfigSnapshot{RunID: "run-1"}); err == nil {
		t.Fatal("duplicate snapshot must fail")
	}
	if _, err := st.GetRunConfigSnapshotByRun(ctx, "missing"); err == nil {
		t.Fatal("expected snapshot miss")
	}
}

func TestRunEventFieldsPersist(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	task := &domain.Task{Title: "T", Status: domain.TaskTodo}
	_ = st.CreateTask(ctx, task)
	agent := &domain.Agent{Name: "A"}
	_ = st.CreateAgent(ctx, agent)
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Trigger: "manual"}
	_ = st.CreateRun(ctx, run)

	event := &domain.RunEvent{RunID: run.ID, Seq: 1, Type: "tool_call", Message: "x", Payload: map[string]any{"tool": "Bash"}, Source: "adapter", Level: "warn", Truncated: true}
	if err := st.AppendRunEvent(ctx, event); err != nil {
		t.Fatalf("append: %v", err)
	}
	loaded, err := st.ListRunEvents(ctx, run.ID)
	if err != nil || len(loaded) != 1 {
		t.Fatalf("list: %#v err=%v", loaded, err)
	}
	if loaded[0].Source != "adapter" || loaded[0].Level != "warn" || !loaded[0].Truncated || loaded[0].PayloadVersion != 1 {
		t.Fatalf("event fields lost: %#v", loaded[0])
	}
}

func TestRunFieldRoundTripAndCancelRequest(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	task := &domain.Task{Title: "T", Status: domain.TaskTodo}
	_ = st.CreateTask(ctx, task)
	agent := &domain.Agent{Name: "A"}
	_ = st.CreateAgent(ctx, agent)

	exitCode := 3
	ended := domain.Now()
	run := &domain.Run{
		TaskID: task.ID, AgentID: agent.ID, Status: domain.RunQueued, Trigger: "manual",
		AgentVersionID: "v1", BaseCommit: "base", HeadCommit: "head",
	}
	if err := st.CreateRun(ctx, run); err != nil {
		t.Fatalf("create: %v", err)
	}
	if run.WorkspaceID != "default" || run.Attempt != 1 || run.QueuedAt == nil {
		t.Fatalf("run defaults: %#v", run)
	}

	run.Status = domain.RunCompleted
	run.ErrorCode = "runtime_error"
	run.FailureDetail = "nonzero_exit"
	run.ExitCode = &exitCode
	run.EndedAt = &ended
	run.LastEventAt = &ended
	if err := st.UpdateRun(ctx, run); err != nil {
		t.Fatalf("update: %v", err)
	}
	loaded, err := st.GetRun(ctx, run.ID)
	if err != nil || loaded.ErrorCode != "runtime_error" || loaded.ExitCode == nil || *loaded.ExitCode != 3 || loaded.HeadCommit != "head" {
		t.Fatalf("roundtrip: %#v err=%v", loaded, err)
	}

	if ok, _ := st.UpdateRunIfActive(ctx, loaded); ok {
		t.Fatal("completed run must not update through the active guard")
	}
	if ok, _ := st.MarkRunCancelRequested(ctx, loaded.ID); ok {
		t.Fatal("terminal run must not accept a cancel request")
	}

	queued := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Trigger: "manual"}
	_ = st.CreateRun(ctx, queued)
	if ok, err := st.MarkRunCancelRequested(ctx, queued.ID); !ok || err != nil {
		t.Fatalf("mark cancel: %v %v", ok, err)
	}
	stored, _ := st.GetRun(ctx, queued.ID)
	if stored.CancelRequestedAt == nil {
		t.Fatal("cancelRequestedAt not persisted")
	}
	if !stored.CancelRequestedAt.Before(time.Now().Add(time.Minute)) {
		t.Fatalf("unexpected cancel timestamp %v", stored.CancelRequestedAt)
	}
}

func TestWorkspaceSettingsToleratesBadJSON(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	if _, err := st.db.ExecContext(ctx, `UPDATE workspaces SET settings = 'not-json' WHERE id = 'default'`); err != nil {
		t.Fatalf("corrupt settings: %v", err)
	}
	workspace, err := st.GetWorkspace(ctx, domain.DefaultWorkspaceID)
	if err != nil {
		t.Fatalf("get with bad json: %v", err)
	}
	if workspace.Settings.Remote != "" {
		t.Fatalf("bad json should fall back to zero settings: %#v", workspace.Settings)
	}
}

func TestTaskAgentDeleteAndListRuns(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	task := &domain.Task{Title: "T", Status: domain.TaskTodo}
	_ = st.CreateTask(ctx, task)
	agent := &domain.Agent{Name: "A"}
	_ = st.CreateAgent(ctx, agent)
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Trigger: "manual"}
	_ = st.CreateRun(ctx, run)

	runs, err := st.ListRunsByTask(ctx, task.ID)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs by task: %#v err=%v", runs, err)
	}
	allRuns, _ := st.ListRuns(ctx)
	if len(allRuns) != 1 {
		t.Fatalf("list runs = %d", len(allRuns))
	}
	if err := st.DeleteAgent(ctx, agent.ID); err != nil {
		t.Fatalf("delete agent: %v", err)
	}
	if _, err := st.GetAgent(ctx, agent.ID); err == nil {
		t.Fatal("expected agent gone")
	}
	if err := st.DeleteTask(ctx, task.ID); err != nil {
		t.Fatalf("delete task: %v", err)
	}
}

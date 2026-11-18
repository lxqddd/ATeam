package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
)

type mergeScenario struct {
	repo       string
	task       *domain.Task
	run        *domain.Run
	reviewID   string
	baseCommit string
	headCommit string
}

func gitOutputTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	output, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(output))
}

// prepareMergeScenario binds a workspace, creates a completed run on a real
// branch with full evidence, and approves it.
func prepareMergeScenario(t *testing.T, handler http.Handler, st store.Store, withEvidence bool, agentRuntime string) mergeScenario {
	t.Helper()
	ctx := context.Background()
	repo := initRepo(t)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", map[string]any{
		"name": "Merge repo", "repoPath": repo, "defaultBranch": "main",
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("bind workspace = %d (%s)", recorder.Code, recorder.Body.String())
	}

	task := &domain.Task{Title: "Merge task", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	agent := &domain.Agent{Name: "Claude " + agentRuntime, Runtime: agentRuntime}
	if err := st.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}

	base := gitOutputTest(t, repo, "rev-parse", "main")
	branch := "ateam/mergetest/run-1"
	runGit(t, repo, "branch", branch, "main")
	runGit(t, repo, "checkout", branch)
	if err := os.WriteFile(filepath.Join(repo, "feature.txt"), []byte("feature"), 0o644); err != nil {
		t.Fatalf("write feature: %v", err)
	}
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature work")
	head := gitOutputTest(t, repo, "rev-parse", "HEAD")
	runGit(t, repo, "checkout", "main")

	ended := domain.Now()
	run := &domain.Run{
		WorkspaceID: domain.DefaultWorkspaceID,
		TaskID:      task.ID,
		AgentID:     agent.ID,
		Status:      domain.RunCompleted,
		Trigger:     "manual",
		Branch:      branch,
		BaseCommit:  base,
		HeadCommit:  head,
		EndedAt:     &ended,
	}
	if err := st.CreateRun(ctx, run); err != nil {
		t.Fatalf("create run: %v", err)
	}

	writer := artifact.NewWriter(st, t.TempDir())
	for _, artifactType := range []string{domain.ArtifactDiff, domain.ArtifactTestReport} {
		if !withEvidence && artifactType == domain.ArtifactTestReport {
			continue
		}
		if _, err := writer.Save(ctx, artifact.Input{
			WorkspaceID: "default",
			TaskID:      task.ID,
			RunID:       run.ID,
			Type:        artifactType,
			Name:        artifactType + ".txt",
			MediaType:   "text/plain",
			Origin:      domain.ArtifactOriginSystemCollected,
			Data:        []byte(artifactType + " evidence"),
		}); err != nil {
			t.Fatalf("save artifact: %v", err)
		}
	}

	comment := ""
	if agentRuntime == "mock" {
		comment = "no automated tests applicable for this mock run"
	}
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/reviews", map[string]any{
		"decision": "approve", "comment": comment,
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create review = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var review domain.Review
	if err := json.Unmarshal(recorder.Body.Bytes(), &review); err != nil {
		t.Fatalf("decode review: %v", err)
	}
	return mergeScenario{repo: repo, task: task, run: run, reviewID: review.ID, baseCommit: base, headCommit: head}
}

func TestReviewApproveAndMergeFlow(t *testing.T) {
	handler, st := newTestHandler(t)
	scenario := prepareMergeScenario(t, handler, st, true, "claude")

	// The review approval moves the task to in_review.
	task, err := st.GetTask(context.Background(), scenario.task.ID)
	if err != nil || task.Status != domain.TaskInReview {
		t.Fatalf("task status = %v err=%v", task, err)
	}

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId":           scenario.reviewID,
		"expectedHeadCommit": scenario.headCommit,
		"targetBranch":       "main",
		"strategy":           "squash",
		"confirm":            true,
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("merge = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var record domain.MergeRecord
	if err := json.Unmarshal(recorder.Body.Bytes(), &record); err != nil {
		t.Fatalf("decode merge record: %v", err)
	}
	if record.Commit == "" || record.Result != "merged" || record.TargetBranch != "main" {
		t.Fatalf("unexpected merge record: %#v", record)
	}
	if _, err := os.Stat(filepath.Join(scenario.repo, "feature.txt")); err != nil {
		t.Fatalf("feature file missing after merge: %v", err)
	}
	if head := gitOutputTest(t, scenario.repo, "rev-parse", "HEAD"); head != record.Commit {
		t.Fatalf("repo head = %q, record commit = %q", head, record.Commit)
	}
	// The system must not mark the task done on merge.
	task, _ = st.GetTask(context.Background(), scenario.task.ID)
	if task.Status != domain.TaskInReview {
		t.Fatalf("task must stay in_review, got %q", task.Status)
	}

	// Repeat merge is rejected.
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId":           scenario.reviewID,
		"expectedHeadCommit": scenario.headCommit,
		"targetBranch":       "main",
		"strategy":           "squash",
		"confirm":            true,
	})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("repeat merge = %d", recorder.Code)
	}
	if body := decodeM1Error(t, recorder); body.Code != "RUN_ALREADY_MERGED" {
		t.Fatalf("unexpected code: %#v", body)
	}
}

func TestMergeRequiresApprovedReviewAndFreshEvidence(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()
	repo := initRepo(t)
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", map[string]any{"repoPath": repo, "defaultBranch": "main"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("bind = %d", recorder.Code)
	}

	task := &domain.Task{Title: "Review gate", Status: domain.TaskTodo}
	_ = st.CreateTask(ctx, task)
	agent := &domain.Agent{Name: "Claude", Runtime: "claude"}
	_ = st.CreateAgent(ctx, agent)
	ended := domain.Now()
	run := &domain.Run{WorkspaceID: domain.DefaultWorkspaceID, TaskID: task.ID, AgentID: agent.ID, Status: domain.RunCompleted, Trigger: "manual", Branch: "ateam/x/run", BaseCommit: "base", HeadCommit: "head", EndedAt: &ended}
	_ = st.CreateRun(ctx, run)
	task.Status = domain.TaskInReview
	_ = st.UpdateTask(ctx, task)

	// No review at all -> REVIEW_REQUIRED.
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/merge", map[string]any{
		"reviewId": "missing", "expectedHeadCommit": "head", "targetBranch": "main", "confirm": true,
	})
	if recorder.Code != http.StatusConflict || decodeM1Error(t, recorder).Code != "REVIEW_REQUIRED" {
		t.Fatalf("missing review = %d (%s)", recorder.Code, recorder.Body.String())
	}

	// Approved review whose evidence changed -> STALE_EVIDENCE.
	writer := artifact.NewWriter(st, t.TempDir())
	if _, err := writer.Save(ctx, artifact.Input{WorkspaceID: "default", TaskID: task.ID, RunID: run.ID, Type: domain.ArtifactDiff, Name: "diff.txt", MediaType: "text/plain", Data: []byte("diff")}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := writer.Save(ctx, artifact.Input{WorkspaceID: "default", TaskID: task.ID, RunID: run.ID, Type: domain.ArtifactTestReport, Name: "test.txt", MediaType: "text/plain", Data: []byte("tests")}); err != nil {
		t.Fatalf("save test report: %v", err)
	}
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/reviews", map[string]any{"decision": "approve"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("approve = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var review domain.Review
	_ = json.Unmarshal(recorder.Body.Bytes(), &review)
	if _, err := writer.Save(ctx, artifact.Input{WorkspaceID: "default", TaskID: task.ID, RunID: run.ID, Type: domain.ArtifactNote, Name: "late.txt", MediaType: "text/plain", Data: []byte("late evidence")}); err != nil {
		t.Fatalf("save second: %v", err)
	}
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/merge", map[string]any{
		"reviewId": review.ID, "expectedHeadCommit": "head", "targetBranch": "main", "confirm": true,
	})
	if recorder.Code != http.StatusPreconditionFailed || decodeM1Error(t, recorder).Code != "STALE_EVIDENCE" {
		t.Fatalf("stale evidence = %d (%s)", recorder.Code, recorder.Body.String())
	}
	stored, _ := st.GetReview(ctx, review.ID)
	if stored.Status != domain.ReviewSuperseded {
		t.Fatalf("review status = %q, want superseded", stored.Status)
	}
}

func TestApproveIncompleteDoDRequiresException(t *testing.T) {
	handler, st := newTestHandler(t)
	scenario := prepareMergeScenario(t, handler, st, false, "mock")

	// The scenario helper records the exception for mock runs, so approving
	// again without a comment on a new pending review must fail.
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/reviews", map[string]any{"decision": "approve"})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("approve without exception = %d (%s)", recorder.Code, recorder.Body.String())
	}
	if body := decodeM1Error(t, recorder); body.Code != "VALIDATION_FAILED" {
		t.Fatalf("unexpected code: %#v", body)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/reviews", map[string]any{
		"decision": "approve", "comment": "manual verification performed",
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("approve with exception = %d (%s)", recorder.Code, recorder.Body.String())
	}
}

func TestMergeBlocksOnDirtyWorkspace(t *testing.T) {
	handler, st := newTestHandler(t)
	scenario := prepareMergeScenario(t, handler, st, true, "claude")
	if err := os.WriteFile(filepath.Join(scenario.repo, "dirty.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("dirty file: %v", err)
	}

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId": scenario.reviewID, "expectedHeadCommit": scenario.headCommit, "targetBranch": "main", "confirm": true,
	})
	if recorder.Code != http.StatusConflict || decodeM1Error(t, recorder).Code != "WORKSPACE_DIRTY" {
		t.Fatalf("dirty workspace = %d (%s)", recorder.Code, recorder.Body.String())
	}
}

func TestReviewCommentLifecycle(t *testing.T) {
	handler, st := newTestHandler(t)
	scenario := prepareMergeScenario(t, handler, st, true, "claude")

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/reviews/"+scenario.reviewID+"/comments", map[string]any{
		"filePath": "src/app.ts", "line": 12, "severity": "blocking", "body": "please fix",
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("comment = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var comment domain.ReviewComment
	_ = json.Unmarshal(recorder.Body.Bytes(), &comment)

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/reviews/"+scenario.reviewID+"/comments", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list comments = %d", recorder.Code)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/review-comments/"+comment.ID+"/resolve", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("resolve = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var resolved domain.ReviewComment
	_ = json.Unmarshal(recorder.Body.Bytes(), &resolved)
	if resolved.ResolvedAt == nil {
		t.Fatal("resolvedAt missing")
	}
}

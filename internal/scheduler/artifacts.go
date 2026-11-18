package scheduler

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
)

// collectRunArtifacts gathers the evidence for a finished run: a log bundle
// and summary note for every run, plus the diff and system-run verification
// reports for code-changing runs (PRD runtime-and-workspace §10.2).
func (s *Scheduler) collectRunArtifacts(
	ctx context.Context,
	run *domain.Run,
	task *domain.Task,
	workdir string,
	codeChange bool,
	settings domain.WorkspaceSettings,
	emit func(runtime.Event),
) {
	if s.artifacts == nil {
		return
	}

	if recorded, err := s.store.ListRunEvents(ctx, run.ID); err == nil {
		var builder strings.Builder
		for _, event := range recorded {
			fmt.Fprintf(&builder, "%s [%s] %s\n", event.CreatedAt.Format(time.RFC3339), event.Type, event.Message)
		}
		s.saveArtifact(ctx, run, artifact.Input{
			Type:      domain.ArtifactLogBundle,
			Subtype:   "run_log",
			Name:      "run.log",
			MediaType: "text/plain",
			Origin:    domain.ArtifactOriginSystemCollected,
			Data:      []byte(builder.String()),
		}, emit)
	} else {
		emit(runtime.Event{Type: "error", Message: "failed to collect the run log bundle", Data: map[string]any{"detail": "artifact_collection_failed"}, Level: "error"})
	}

	summary := strings.TrimSpace(run.Summary)
	if strings.TrimSpace(run.Error) != "" {
		if summary != "" {
			summary += "\n"
		}
		summary += "error: " + run.Error
	}
	if summary != "" {
		s.saveArtifact(ctx, run, artifact.Input{
			Type:      domain.ArtifactNote,
			Name:      "summary.md",
			MediaType: "text/markdown",
			Origin:    domain.ArtifactOriginSystemCollected,
			Data:      []byte(summary),
		}, emit)
	}

	if !codeChange || workdir == "" {
		return
	}

	diff, err := s.workspaces.CollectDiff(ctx, workdir, run.BaseCommit)
	if err != nil {
		emit(runtime.Event{Type: "error", Message: "failed to collect the run diff", Data: map[string]any{"detail": "artifact_collection_failed"}, Level: "error"})
	} else {
		body := []byte(diff.Render())
		saved := s.saveArtifact(ctx, run, artifact.Input{
			Type:      domain.ArtifactDiff,
			Name:      "run.diff",
			MediaType: "text/plain",
			Origin:    domain.ArtifactOriginSystemCollected,
			Data:      body,
		}, emit)
		if saved != nil && saved.Truncated {
			// The diff artifact is capped at 10 MiB; keep the full diff as a
			// log_bundle so nothing is lost (M1-ART-004).
			s.saveArtifact(ctx, run, artifact.Input{
				Type:      domain.ArtifactLogBundle,
				Subtype:   "diff_full",
				Name:      "diff.full.txt",
				MediaType: "text/plain",
				Origin:    domain.ArtifactOriginSystemCollected,
				Data:      body,
			}, emit)
		}
	}

	for _, verification := range artifact.RunVerificationCommands(ctx, workdir, settings.VerificationCommands) {
		passed := verification.ExitCode == 0
		emit(runtime.Event{
			Type:    "test_result",
			Message: verification.Command,
			Data: map[string]any{
				"command":             verification.Command,
				"exitCode":            verification.ExitCode,
				"passed":              passed,
				"durationMs":          verification.Duration.Milliseconds(),
				"verificationTimeout": verification.TimedOut,
			},
			Source: "scheduler",
		})
		s.saveArtifact(ctx, run, artifact.Input{
			Type:      domain.ArtifactTestReport,
			Name:      commandArtifactName(verification.Command),
			MediaType: "text/plain",
			Origin:    domain.ArtifactOriginSystemVerification,
			Data:      []byte(verification.Render()),
		}, emit)
	}
}

// captureAgentArtifact stores a file the adapter declared through an
// `artifact` event, after validating that the path stays inside the run
// workspace (M1-ART-001/004, API-1083).
func (s *Scheduler) captureAgentArtifact(
	ctx context.Context,
	run *domain.Run,
	workdir string,
	event runtime.Event,
	emit func(runtime.Event),
) {
	if s.artifacts == nil || event.Data == nil {
		return
	}
	relative, _ := event.Data["path"].(string)
	if strings.TrimSpace(relative) == "" {
		return
	}
	artifactType, _ := event.Data["type"].(string)
	if artifactType == "" {
		artifactType = domain.ArtifactFile
	}
	mediaType, _ := event.Data["mediaType"].(string)
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}

	fullPath, err := safeWorkspacePath(workdir, relative)
	if err != nil {
		emit(runtime.Event{Type: "error", Message: "artifact path rejected: " + err.Error(), Data: map[string]any{"detail": "path_denied"}, Level: "error"})
		return
	}
	info, err := os.Stat(fullPath)
	if err != nil || info.IsDir() {
		emit(runtime.Event{Type: "warning", Message: "declared artifact is not a readable file", Data: map[string]any{"path": relative}, Level: "warn"})
		return
	}
	if info.Size() > artifact.MaxArtifactBytes {
		emit(runtime.Event{Type: "warning", Message: "declared artifact exceeds the 50 MiB limit and was rejected", Data: map[string]any{"path": relative}, Level: "warn"})
		return
	}
	data, err := os.ReadFile(fullPath)
	if err != nil {
		emit(runtime.Event{Type: "warning", Message: "declared artifact could not be read", Data: map[string]any{"path": relative}, Level: "warn"})
		return
	}
	s.saveArtifact(ctx, run, artifact.Input{
		Type:      artifactType,
		Name:      filepath.Base(fullPath),
		MediaType: mediaType,
		Origin:    domain.ArtifactOriginAgent,
		Data:      data,
	}, emit)
}

func (s *Scheduler) saveArtifact(ctx context.Context, run *domain.Run, input artifact.Input, emit func(runtime.Event)) *domain.Artifact {
	input.WorkspaceID = run.WorkspaceID
	input.TaskID = run.TaskID
	input.RunID = run.ID
	saved, err := s.artifacts.Save(ctx, input)
	if err != nil {
		emit(runtime.Event{Type: "error", Message: "failed to store an artifact", Data: map[string]any{"detail": "artifact_write_failed", "artifactType": input.Type}, Level: "error"})
		return nil
	}
	s.hub.Broadcast(events.Event{Type: "artifact.created", Data: saved})
	emit(runtime.Event{
		Type:    "artifact",
		Message: saved.Name,
		Data:    map[string]any{"artifactId": saved.ID, "kind": saved.Type, "name": saved.Name, "origin": saved.Origin},
		Source:  "scheduler",
	})
	return saved
}

func commandArtifactName(command string) string {
	name := strings.Fields(command)
	if len(name) == 0 {
		return "verification.txt"
	}
	return strings.Join(name, "_") + ".txt"
}

// safeWorkspacePath resolves a workspace-relative path and rejects absolute
// paths, parent traversal and symlink escapes.
func safeWorkspacePath(workdir, relative string) (string, error) {
	if filepath.IsAbs(relative) {
		return "", fmt.Errorf("absolute paths are not allowed")
	}
	cleaned := filepath.Clean(relative)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes the run workspace")
	}
	full := filepath.Join(workdir, cleaned)
	resolvedRoot, err := filepath.EvalSymlinks(workdir)
	if err != nil {
		return "", fmt.Errorf("resolve run workspace: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", fmt.Errorf("resolve artifact path: %w", err)
	}
	if resolved != resolvedRoot && !strings.HasPrefix(resolved, resolvedRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes the run workspace")
	}
	return resolved, nil
}

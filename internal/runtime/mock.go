package runtime

import (
	"context"
	"fmt"
	"time"
)

type MockAdapter struct{}

func (a *MockAdapter) Name() string { return "mock" }

// TestModel reports the built-in mock runtime as reachable without making a
// network request.
func (a *MockAdapter) TestModel(context.Context, string) (ModelTestResult, error) {
	return ModelTestResult{Reply: "mock runtime is always available"}, nil
}

// Probe reports the built-in mock runtime as always available.
func (a *MockAdapter) Probe(context.Context) ProbeInfo {
	return ProbeInfo{Name: a.Name(), Version: "builtin", Compatible: true}
}

func (a *MockAdapter) Run(ctx context.Context, req Request, emit func(Event)) error {
	steps := []string{
		"Reading task context and agent instructions",
		"Preparing the isolated workspace",
		"Simulating implementation work",
		"Checking the diff and preparing a summary",
	}
	for index, step := range steps {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(350 * time.Millisecond):
		}
		emit(Event{
			Type:    "log",
			Message: fmt.Sprintf("[%d/%d] %s", index+1, len(steps), step),
		})
	}
	emit(Event{
		Type:    "summary",
		Message: "Mock run completed. Configure a real runtime adapter to execute Claude Code or Codex.",
	})
	return nil
}

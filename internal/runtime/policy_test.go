package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPathAllowed(t *testing.T) {
	workdir := t.TempDir()
	cases := []struct {
		path    string
		allowed []string
		want    bool
	}{
		{"apps/web/page.tsx", []string{"apps/web"}, true},
		{"apps/web/page.tsx", []string{"apps/web/"}, true},
		{filepath.Join(workdir, "apps/web/page.tsx"), []string{"apps/web"}, true},
		{"apps/api/main.go", []string{"apps/web"}, false},
		{"../../etc/passwd", []string{"apps/web"}, false},
		{"apps/web/../../etc/passwd", []string{"apps/web"}, false},
		{"apps/web/page.tsx", nil, false},
	}
	for _, test := range cases {
		got := PathAllowed(test.path, workdir, test.allowed)
		if got != test.want {
			t.Errorf("PathAllowed(%q, %v) = %v, want %v", test.path, test.allowed, got, test.want)
		}
	}
}

func TestPathAllowedRejectsSymlinkEscape(t *testing.T) {
	workdir := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(workdir, "allowed")); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}
	if PathAllowed("allowed/escape.txt", workdir, []string{"allowed"}) {
		t.Fatal("a symlinked allowed directory must not escape the worktree")
	}
}

func TestCommandAllowed(t *testing.T) {
	cases := []struct {
		command string
		allowed []string
		want    bool
	}{
		{"go test ./...", []string{"go test"}, true},
		{"go test ./...", []string{"go"}, true},
		{"go build ./...", []string{"go test"}, false},
		{"rm -rf /", []string{"go test"}, false},
		{"go test ./... && rm -rf /", []string{"go test"}, false},
		{"echo $(rm -rf /)", []string{"echo"}, false},
		{"npm test", nil, false},
	}
	for _, test := range cases {
		got := CommandAllowed(test.command, test.allowed)
		if got != test.want {
			t.Errorf("CommandAllowed(%q, %v) = %v, want %v", test.command, test.allowed, got, test.want)
		}
	}
}

func TestPolicyGuardStopsOnWriteOutsideAllowedPaths(t *testing.T) {
	stopped := false
	guard := NewPolicyGuard(&Policy{AllowedPaths: []string{"apps/web"}}, t.TempDir(), func() { stopped = true })
	if guard.CheckTool("Write", map[string]any{"file_path": "apps/api/main.go"}) {
		t.Fatal("write outside allowedPaths must be denied")
	}
	if !stopped {
		t.Fatal("guard must stop the runtime")
	}
	if violated, detail := guard.Violated(); !violated || detail == "" {
		t.Fatalf("violated = %v, detail = %q", violated, detail)
	}
}

func TestClaudeAdapterDeniesToolOutsidePolicy(t *testing.T) {
	writeFakeClaude(t, `if [ "$1" = "-p" ]; then
  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"'$PWD'/escape.txt"}}]}}'
  echo '{"type":"result","subtype":"success","is_error":false,"result":"done"}'
  exit 0
fi
exit 1`)
	workdir := t.TempDir()
	emit, events := collectEvents()
	err := (&ClaudeAdapter{}).Run(context.Background(), Request{
		Prompt:  "write a file",
		Workdir: workdir,
		Policy:  &Policy{AllowedPaths: []string{"allowed/"}},
	}, emit)
	if err == nil {
		t.Fatal("expected permission denial")
	}
	var runtimeErr *Error
	if !errors.As(err, &runtimeErr) || runtimeErr.Detail != "path_outside_workspace" {
		t.Fatalf("err = %v", err)
	}
	found := false
	for _, event := range *events {
		if event.Type == "error" && event.Data["errorCode"] == "permission_denied" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected permission_denied event, got %#v", *events)
	}
	if _, statErr := os.Stat(filepath.Join(workdir, "escape.txt")); !os.IsNotExist(statErr) {
		t.Fatal("adapter must stop before the tool writes outside the policy")
	}
}

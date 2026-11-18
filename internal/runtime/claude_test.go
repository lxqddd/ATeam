package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// writeFakeClaude installs a fake `claude` executable on PATH. The script
// must answer --version and --help for the probe; the scenario body runs for
// an actual invocation.
func writeFakeClaude(t *testing.T, body string) string {
	t.Helper()
	binDir := t.TempDir()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then echo \"9.9.9 (Claude Test)\"; exit 0; fi\n" +
		"if [ \"$1\" = \"--help\" ]; then echo \"usage: claude --output-format --permission-mode --verbose\"; exit 0; fi\n" +
		body + "\n"
	if err := os.WriteFile(filepath.Join(binDir, "claude"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	claudeProbeCache.Delete("claude")
	return binDir
}

func collectEvents() (func(Event), *[]Event) {
	events := &[]Event{}
	return func(event Event) { *events = append(*events, event) }, events
}

func TestClaudeAdapterTestModel(t *testing.T) {
	writeFakeClaude(t, `if [ "$1" = "-p" ]; then
  echo '{"type":"result","subtype":"success","is_error":false,"result":"OK"}'
  exit 0
fi
exit 1`)
	result, err := (&ClaudeAdapter{}).TestModel(context.Background(), "deepseek")
	if err != nil {
		t.Fatalf("test model: %v", err)
	}
	if result.Reply != "OK" {
		t.Fatalf("reply = %q, want OK", result.Reply)
	}
	if result.Latency <= 0 {
		t.Fatalf("latency = %v", result.Latency)
	}
}

func TestClaudeAdapterMapsStreamJSON(t *testing.T) {
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args.txt")
	stdinFile := filepath.Join(dir, "stdin.txt")
	writeFakeClaude(t, `
echo "$@" > "`+argsFile+`"
cat > "`+stdinFile+`" &
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"working on it"},{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"src/app.ts"}}]}}'
echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":false,"content":"ok"}]}}'
echo 'not json at all'
echo '{"type":"result","subtype":"success","is_error":false,"result":"all done","session_id":"sess-1","num_turns":2,"total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":20}}'
exit 0
`)

	adapter := &ClaudeAdapter{}
	emit, events := collectEvents()
	err := adapter.Run(context.Background(), Request{
		Prompt:         "fix the bug",
		Workdir:        t.TempDir(),
		PermissionMode: "controlled_edit",
	}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	types := map[string]bool{}
	for _, event := range *events {
		types[event.Type] = true
	}
	for _, expected := range []string{"status", "tool_call", "file_change", "tool_result", "log", "usage", "done"} {
		if !types[expected] {
			t.Errorf("missing event type %q (got %v)", expected, types)
		}
	}

	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	joined := string(args)
	for _, expected := range []string{"-p", "fix the bug", "--output-format stream-json", "--verbose", "--permission-mode acceptEdits"} {
		if !strings.Contains(joined, expected) {
			t.Errorf("argv missing %q: %s", expected, joined)
		}
	}
}

func TestClaudeAdapterReadOnlyPermissionFlags(t *testing.T) {
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args.txt")
	writeFakeClaude(t, `echo "$@" > "`+argsFile+`"; exit 0`)
	adapter := &ClaudeAdapter{}
	emit, _ := collectEvents()
	if err := adapter.Run(context.Background(), Request{
		Prompt:         "inspect only",
		Workdir:        t.TempDir(),
		PermissionMode: "read_only",
	}, emit); err != nil {
		t.Fatalf("run: %v", err)
	}
	args, _ := os.ReadFile(argsFile)
	joined := string(args)
	if !strings.Contains(joined, "--permission-mode plan") {
		t.Fatalf("read_only should use plan mode: %s", joined)
	}
	if !strings.Contains(joined, "--disallowedTools") || !strings.Contains(joined, "Write,Edit,NotebookEdit,Bash") {
		t.Fatalf("read_only should disable write tools: %s", joined)
	}
}

func TestClaudeAdapterLongPromptUsesStdin(t *testing.T) {
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args.txt")
	stdinFile := filepath.Join(dir, "stdin.txt")
	writeFakeClaude(t, `echo "$@" > "`+argsFile+`"; cat > "`+stdinFile+`"; exit 0`)
	adapter := &ClaudeAdapter{}
	emit, _ := collectEvents()
	longPrompt := strings.Repeat("x", maxPromptArgBytes+100)
	if err := adapter.Run(context.Background(), Request{Prompt: longPrompt, Workdir: t.TempDir()}, emit); err != nil {
		t.Fatalf("run: %v", err)
	}
	args, _ := os.ReadFile(argsFile)
	if strings.Contains(string(args), longPrompt) {
		t.Fatal("long prompt must not travel as an argument")
	}
	stdinContent, _ := os.ReadFile(stdinFile)
	if !strings.HasPrefix(string(stdinContent), strings.Repeat("x", 100)) {
		t.Fatalf("stdin prompt missing (got %d bytes)", len(stdinContent))
	}
}

func TestClaudeAdapterSanitizesEnvironment(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, "env.txt")
	writeFakeClaude(t, `env > "`+envFile+`"; exit 0`)
	t.Setenv("MY_API_KEY", "secret-value")
	t.Setenv("SOME_SERVICE_TOKEN", "token-value")
	t.Setenv("DB_PASSWORD", "pw-value")

	adapter := &ClaudeAdapter{}
	emit, _ := collectEvents()
	if err := adapter.Run(context.Background(), Request{Prompt: "hello", Workdir: t.TempDir()}, emit); err != nil {
		t.Fatalf("run: %v", err)
	}
	env, _ := os.ReadFile(envFile)
	content := string(env)
	for _, leaked := range []string{"MY_API_KEY", "SOME_SERVICE_TOKEN", "DB_PASSWORD"} {
		if strings.Contains(content, leaked) {
			t.Fatalf("sensitive variable %q leaked to the runtime: %s", leaked, content)
		}
	}
	if !strings.Contains(content, "PATH=") {
		t.Fatal("PATH must be forwarded")
	}
}

func TestClaudeAdapterClassifiesFailures(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		detail string
	}{
		{"auth", `echo "Not logged in. Please run claude login" >&2; exit 1`, "runtime_auth"},
		{"rate limit", `echo "Error 429 rate limit exceeded" >&2; exit 1`, "runtime_unavailable"},
		{"nonzero", `echo "segfault" >&2; exit 2`, "nonzero_exit"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			writeFakeClaude(t, testCase.body)
			adapter := &ClaudeAdapter{}
			emit, _ := collectEvents()
			err := adapter.Run(context.Background(), Request{Prompt: "x", Workdir: t.TempDir()}, emit)
			var runtimeErr *Error
			if !errors.As(err, &runtimeErr) {
				t.Fatalf("expected *runtime.Error, got %v", err)
			}
			if runtimeErr.Detail != testCase.detail {
				t.Fatalf("detail = %q, want %q", runtimeErr.Detail, testCase.detail)
			}
		})
	}
}

func TestClaudeAdapterProbeRejectsMissingFlags(t *testing.T) {
	binDir := t.TempDir()
	script := "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 9.9.9; exit 0; fi\necho \"usage: claude --output-format --verbose\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "claude"), []byte(script), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	claudeProbeCache.Delete("claude")

	adapter := &ClaudeAdapter{}
	probe := adapter.Probe(context.Background())
	if probe.Compatible {
		t.Fatal("probe must reject a CLI missing required flags")
	}
	if !strings.Contains(probe.Detail, "--permission-mode") {
		t.Fatalf("detail should name the missing flag: %q", probe.Detail)
	}

	emit, _ := collectEvents()
	err := adapter.Run(context.Background(), Request{Prompt: "x", Workdir: t.TempDir()}, emit)
	var runtimeErr *Error
	if !errors.As(err, &runtimeErr) || runtimeErr.Detail != "runtime_version_unsupported" {
		t.Fatalf("run error = %v, want runtime_version_unsupported", err)
	}
}

func TestClaudeAdapterCancelKillsProcessGroup(t *testing.T) {
	previousGrace := killGraceNanos.Load()
	killGraceNanos.Store(int64(200 * time.Millisecond))
	t.Cleanup(func() { killGraceNanos.Store(previousGrace) })

	dir := t.TempDir()
	pidFile := filepath.Join(dir, "pid.txt")
	// The fake CLI ignores SIGTERM so only SIGKILL to the process group stops it.
	writeFakeClaude(t, `
trap '' TERM
echo $$ > "`+pidFile+`"
echo '{"type":"system","subtype":"init"}'
sleep 60
exit 0
`)

	adapter := &ClaudeAdapter{}
	emit, _ := collectEvents()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- adapter.Run(ctx, Request{Prompt: "x", Workdir: t.TempDir()}, emit)
	}()

	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(pidFile); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fake CLI never started")
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("run error = %v, want context.Canceled", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("adapter did not return after cancel")
	}

	content, _ := os.ReadFile(pidFile)
	pid, err := strconv.Atoi(strings.TrimSpace(string(content)))
	if err != nil {
		t.Fatalf("parse pid: %v", err)
	}
	if pid > 0 {
		time.Sleep(100 * time.Millisecond)
		if err := syscall.Kill(pid, 0); err == nil {
			t.Fatalf("process %d still alive after cancel", pid)
		}
	}
}

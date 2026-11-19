package runtime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFakeAppServer(t *testing.T, argsFile, permFile string) {
	t.Helper()
	binDir := t.TempDir()
	script := "#!/bin/sh\n"
	if argsFile != "" {
		script += fmt.Sprintf("echo \"$@\" > %q\n", argsFile)
	}
	script += `while IFS= read -r line; do
  id=$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"userAgent":"codex-test"}}\n' "$id" ;;
    *'"method":"initialized"'*) ;;
    *'"method":"thread/start"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"thread":{"id":"th1"}}}\n' "$id" ;;
    *'"method":"turn/start"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"turn":{"id":"turn1"}}}\n' "$id"
      printf '{"jsonrpc":"2.0","method":"item/agentMessage/delta","params":{"threadId":"th1","delta":"hello codex"}}\n'
      printf '{"jsonrpc":"2.0","method":"item/started","params":{"threadId":"th1","item":{"id":"c1","type":"commandExecution","command":"pwd","status":"inProgress"}}}\n'
      printf '{"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"th1","item":{"id":"c1","type":"commandExecution","command":"pwd","status":"completed","exitCode":0,"aggregatedOutput":"ok"}}}\n'
      printf '{"jsonrpc":"2.0","method":"thread/tokenUsage/updated","params":{"threadId":"th1","tokenUsage":{"last":{"inputTokens":5,"outputTokens":2,"totalTokens":7}}}}\n'
`
	if permFile != "" {
		script += fmt.Sprintf(`      printf '{"jsonrpc":"2.0","id":"ap1","method":"item/commandExecution/requestApproval","params":{"threadId":"th1","command":"pwd"}}\n'
      IFS= read -r answer
      printf '%%s\n' "$answer" >> %q
`, permFile)
	}
	script += `      printf '{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"th1","turn":{"id":"turn1","status":"completed"}}}\n' ;;
  esac
done
`
	if err := os.WriteFile(filepath.Join(binDir, "fake-appserver"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake app-server: %v", err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
}

func appServerTestManifest() Manifest {
	return Manifest{
		ID: "fake-app", Executable: "fake-appserver", Transport: TransportAppServer,
		SessionArgs:       []string{"app-server"},
		ExecArgs:          []string{"exec"},
		ModelLaunchConfig: "model",
		PermissionModes:   PermissionMapping{ReadOnly: "read-only", ControlledEdit: "workspace-write", FullAccess: "danger-full-access"},
	}
}

func TestAppServerDriverMapsTurn(t *testing.T) {
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	writeFakeAppServer(t, argsFile, "")
	manifest := appServerTestManifest()
	driver, _ := NewDriver(manifest)
	emit, events := collectEventsConcurrent()
	err := driver.Run(context.Background(), SessionRequest{Manifest: manifest, Request: Request{
		Prompt: "hello", Workdir: t.TempDir(), Model: "gpt-5", PermissionMode: "controlled_edit",
	}}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	args, _ := os.ReadFile(argsFile)
	if !strings.Contains(string(args), `-c model="gpt-5" app-server`) {
		t.Fatalf("launch args = %s", args)
	}
	types := map[string]bool{}
	for _, event := range *events {
		types[event.Type] = true
		if event.Type == "log" && event.Source == "assistant" && event.Message != "hello codex" {
			t.Fatalf("assistant log = %q", event.Message)
		}
		if event.Type == "tool_result" && event.Data["ok"] != true {
			t.Fatalf("tool result = %#v", event.Data)
		}
	}
	for _, want := range []string{"status", "log", "tool_call", "tool_result", "usage", "done"} {
		if !types[want] {
			t.Fatalf("missing event %q; got %v", want, types)
		}
	}
}

func TestAppServerDriverApprovalHonorsPolicy(t *testing.T) {
	permFile := filepath.Join(t.TempDir(), "perm.txt")
	writeFakeAppServer(t, "", permFile)
	manifest := appServerTestManifest()
	driver, _ := NewDriver(manifest)
	emit, _ := collectEventsConcurrent()
	err := driver.Run(context.Background(), SessionRequest{Manifest: manifest, Request: Request{
		Prompt: "hello", Workdir: t.TempDir(), PermissionMode: "controlled_edit",
		Policy: &Policy{AllowedCommands: []string{"pwd"}},
	}}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	answer, _ := os.ReadFile(permFile)
	if !strings.Contains(string(answer), `"decision":"accept"`) {
		t.Fatalf("approval answer = %s", answer)
	}
}

func TestAppServerDriverDeniesApprovalOutsidePolicy(t *testing.T) {
	permFile := filepath.Join(t.TempDir(), "perm.txt")
	writeFakeAppServer(t, "", permFile)
	manifest := appServerTestManifest()
	driver, _ := NewDriver(manifest)
	emit, _ := collectEventsConcurrent()
	err := driver.Run(context.Background(), SessionRequest{Manifest: manifest, Request: Request{
		Prompt: "hello", Workdir: t.TempDir(), PermissionMode: "controlled_edit",
		Policy: &Policy{},
	}}, emit)
	var runtimeErr *Error
	if !errors.As(err, &runtimeErr) {
		t.Fatalf("expected *runtime.Error, got %v", err)
	}
	if runtimeErr.Detail != "command_not_allowed" {
		t.Fatalf("detail = %q", runtimeErr.Detail)
	}
}

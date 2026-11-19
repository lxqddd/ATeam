package runtime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func writeFakeACP(t *testing.T, permFile string) {
	t.Helper()
	binDir := t.TempDir()
	script := `#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n' "$id" ;;
    *'"method":"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"s1"}}\n' "$id" ;;
    *'"method":"session/set_config_option"'*|*'"method":"session/set_mode"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id" ;;
    *'"method":"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello acp"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"pwd","kind":"execute","status":"pending","rawInput":{"command":"pwd"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed","rawOutput":"ok"}}}\n'
`
	if permFile != "" {
		script += fmt.Sprintf(`      printf '{"jsonrpc":"2.0","id":"perm-1","method":"session/request_permission","params":{"sessionId":"s1","toolCall":{"title":"pwd","kind":"execute","rawInput":{"command":"pwd"}},"options":[{"optionId":"once","kind":"allow_once","name":"Allow"},{"optionId":"reject","kind":"reject_once","name":"Reject"}]}}\n'
      IFS= read -r answer
      printf '%%s\n' "$answer" >> %q
`, permFile)
	}
	script += `      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn","usage":{"inputTokens":3,"outputTokens":2,"totalTokens":5}}}\n' "$id" ;;
  esac
done
`
	if err := os.WriteFile(filepath.Join(binDir, "fake-acp"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake ACP CLI: %v", err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
}

func collectEventsConcurrent() (func(Event), *[]Event) {
	var mu sync.Mutex
	events := &[]Event{}
	return func(event Event) {
		mu.Lock()
		defer mu.Unlock()
		*events = append(*events, event)
	}, events
}

func acpTestManifest() Manifest {
	return Manifest{
		ID: "fake-acp", Executable: "fake-acp", Transport: TransportACP,
		SessionArgs:     []string{"acp"},
		PermissionModes: PermissionMapping{ReadOnly: "plan", ControlledEdit: "build", FullAccess: "build"},
	}
}

func TestACPDriverMapsUpdatesAndUsage(t *testing.T) {
	writeFakeACP(t, "")
	manifest := acpTestManifest()
	driver, _ := NewDriver(manifest)
	emit, events := collectEventsConcurrent()
	err := driver.Run(context.Background(), SessionRequest{Manifest: manifest, Request: Request{
		Prompt: "hello", Workdir: t.TempDir(), Model: "deepseek/deepseek-flash", PermissionMode: "controlled_edit",
	}}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	types := map[string]bool{}
	for _, event := range *events {
		types[event.Type] = true
		if event.Type == "log" && event.Source == "assistant" && event.Message != "hello acp" {
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

func TestACPDriverAllowsPermittedCommand(t *testing.T) {
	permFile := filepath.Join(t.TempDir(), "perm.txt")
	writeFakeACP(t, permFile)
	manifest := acpTestManifest()
	driver, _ := NewDriver(manifest)
	emit, _ := collectEventsConcurrent()
	err := driver.Run(context.Background(), SessionRequest{Manifest: manifest, Request: Request{
		Prompt: "hello", Workdir: t.TempDir(), PermissionMode: "controlled_edit",
		Policy: &Policy{AllowedCommands: []string{"pwd"}},
	}}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	answer, err := os.ReadFile(permFile)
	if err != nil {
		t.Fatalf("permission response: %v", err)
	}
	if !strings.Contains(string(answer), `"optionId":"once"`) && !strings.Contains(string(answer), `"outcome":"selected"`) {
		t.Fatalf("permission answer = %s", answer)
	}
}

func TestACPDriverDeniesCommandOutsidePolicy(t *testing.T) {
	permFile := filepath.Join(t.TempDir(), "perm.txt")
	writeFakeACP(t, permFile)
	manifest := acpTestManifest()
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

func writeFakeACPSteering(t *testing.T, steerFile string) {
	t.Helper()
	binDir := t.TempDir()
	script := `#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{}}}\n' "$id" ;;
    *'"method":"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"s1"}}\n' "$id" ;;
    *'"method":"session/set_config_option"'*|*'"method":"session/set_mode"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id" ;;
    *'"method":"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"working"}}}}\n'
      while IFS= read -r steerLine; do
        steerID=$(printf '%s\n' "$steerLine" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
        case "$steerLine" in
          *'_session/steering'*)
            printf '%s\n' "$steerLine" >> __STEER_FILE__
            printf '{"jsonrpc":"2.0","id":%s,"result":{"outcome":"injected"}}\n' "$steerID"
            break ;;
        esac
      done
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id" ;;
  esac
done
`
	script = strings.ReplaceAll(script, "__STEER_FILE__", fmt.Sprintf("%q", steerFile))
	if err := os.WriteFile(filepath.Join(binDir, "fake-acp"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake ACP steering CLI: %v", err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
}

func TestACPDriverSteersRunningTurn(t *testing.T) {
	steerFile := filepath.Join(t.TempDir(), "steer.txt")
	writeFakeACPSteering(t, steerFile)
	manifest := acpTestManifest()
	driver, _ := NewDriver(manifest)
	emit, events := collectEventsConcurrent()
	steerCh := make(chan string, 1)
	go func() {
		time.Sleep(200 * time.Millisecond)
		steerCh <- "please add tests"
	}()
	err := driver.Run(context.Background(), SessionRequest{Manifest: manifest, Request: Request{
		Prompt: "hello", Workdir: t.TempDir(), PermissionMode: "controlled_edit",
		Control: &SessionControl{Steer: steerCh},
	}}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	steerRequest, err := os.ReadFile(steerFile)
	if err != nil {
		t.Fatalf("steering request: %v", err)
	}
	if !strings.Contains(string(steerRequest), "please add tests") {
		t.Fatalf("steering request = %s", steerRequest)
	}
	found := false
	for _, event := range *events {
		if event.Type == "status" && strings.Contains(event.Message, "steering message injected") {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing steering status event")
	}
}

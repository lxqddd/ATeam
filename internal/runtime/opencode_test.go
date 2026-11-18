package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeFakeOpenCode installs a fake `opencode` executable on PATH. The
// --version/--help answers satisfy the probe; runArgs records `run`
// invocations; runBody is emitted on stdout for actual runs.
func writeFakeOpenCode(t *testing.T, runBody string) string {
	t.Helper()
	binDir := t.TempDir()
	argsFile := filepath.Join(binDir, "args.txt")
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then echo \"opencode 2.3.2\"; exit 0; fi\n" +
		"if [ \"$1\" = \"run\" ] && [ \"$2\" = \"--help\" ]; then echo \"--model --format --agent\"; exit 0; fi\n" +
		"if [ \"$1\" = \"models\" ]; then printf 'deepseek/deepseek-flash\\nglm/glm-5.3\\n'; exit 0; fi\n" +
		"if [ \"$1\" = \"run\" ]; then echo \"$@\" > " + argsFile + "\n" + runBody + "\nexit 0; fi\n" +
		"exit 1\n"
	if err := os.WriteFile(filepath.Join(binDir, "opencode"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake opencode: %v", err)
	}
	t.Setenv("PATH", binDir)
	opencodeProbeCache.Delete("opencode")
	return argsFile
}

func TestOpenCodeProbeDiscoversModels(t *testing.T) {
	writeFakeOpenCode(t, "")
	probe := (&OpenCodeAdapter{}).Probe(context.Background())
	if !probe.Compatible || probe.Version != "opencode 2.3.2" {
		t.Fatalf("probe = %#v", probe)
	}
	if len(probe.Models) != 2 || probe.Models[0].ID != "deepseek/deepseek-flash" {
		t.Fatalf("models = %#v", probe.Models)
	}
	if probe.Models[0].Source != ModelSourceRuntime {
		t.Fatalf("source = %q", probe.Models[0].Source)
	}
}

func TestOpenCodeRunMapsJSONAndPermissionMode(t *testing.T) {
	argsFile := writeFakeOpenCode(t, `echo '{"type":"step_start","part":{"type":"step-start"}}'
echo '{"type":"text","part":{"type":"text","text":"hello from opencode"}}'
echo '{"type":"tool_use","part":{"type":"tool","tool":"read","state":{"status":"completed","output":"file body"}}}'
echo '{"type":"step_finish","part":{"type":"step-finish","reason":"stop","cost":0.01,"tokens":{"input":10,"output":2,"reasoning":1,"cache":{"read":3}}}}'`)
	emit, events := collectEvents()
	dir := t.TempDir()
	err := (&OpenCodeAdapter{}).Run(context.Background(), Request{
		Prompt:         "do the thing",
		Workdir:        dir,
		Model:          "deepseek/deepseek-flash",
		PermissionMode: "read_only",
	}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	joined := string(args)
	for _, want := range []string{"--format", "json", "--model", "deepseek/deepseek-flash", "--agent", "plan"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args missing %q: %s", want, joined)
		}
	}
	if !strings.Contains(joined, "do the thing") {
		t.Fatalf("prompt not passed as argv: %s", joined)
	}

	types := map[string]bool{}
	for _, event := range *events {
		types[event.Type] = true
		switch event.Type {
		case "log":
			if event.Message != "hello from opencode" {
				t.Fatalf("assistant log = %q", event.Message)
			}
		case "tool_result":
			if event.Data["tool"] != "read" || event.Data["ok"] != true {
				t.Fatalf("tool result = %#v", event.Data)
			}
		case "usage":
			if event.Data["costUsd"] != 0.01 || event.Data["inputTokens"] != float64(10) {
				t.Fatalf("usage = %#v", event.Data)
			}
		}
	}
	for _, want := range []string{"status", "log", "tool_result", "usage"} {
		if !types[want] {
			t.Fatalf("missing event type %q; got %v", want, types)
		}
	}
}

func TestOpenCodeRunLongPromptUsesStdin(t *testing.T) {
	argsFile := writeFakeOpenCode(t, `if [ -t 0 ]; then echo '{"type":"error","error":{"type":"stdin","message":"expected prompt on stdin"}}'; exit 1; fi
prompt=$(cat)
echo "{\"type\":\"text\",\"part\":{\"type\":\"text\",\"text\":\"len:${#prompt}\"}}'"`)
	emit, _ := collectEvents()
	longPrompt := strings.Repeat("x", opencodeMaxStdinPrompt+100)
	if err := (&OpenCodeAdapter{}).Run(context.Background(), Request{Prompt: longPrompt, Workdir: t.TempDir()}, emit); err != nil {
		t.Fatalf("run: %v", err)
	}
	args, _ := os.ReadFile(argsFile)
	if strings.Contains(string(args), "xxxxx") {
		t.Fatalf("long prompt must travel over stdin, not argv: %.120s", args)
	}
}

func TestOpenCodeTestModel(t *testing.T) {
	writeFakeOpenCode(t, `echo '{"type":"text","part":{"type":"text","text":"OK"}}'`)
	result, err := (&OpenCodeAdapter{}).TestModel(context.Background(), "deepseek/deepseek-flash")
	if err != nil {
		t.Fatalf("test model: %v", err)
	}
	if result.Reply != "OK" || result.Latency <= 0 {
		t.Fatalf("result = %#v", result)
	}
}

func TestOpenCodeTestModelErrorEnvelope(t *testing.T) {
	writeFakeOpenCode(t, `echo '{"type":"error","error":{"type":"provider.no-route","message":"Model unavailable: nope/x"}}'; exit 1`)
	_, err := (&OpenCodeAdapter{}).TestModel(context.Background(), "nope/x")
	if err == nil {
		t.Fatal("expected error")
	}
	var runtimeErr *Error
	if !errors.As(err, &runtimeErr) || runtimeErr.Detail != "model_test_failed" {
		t.Fatalf("err = %v", err)
	}
}

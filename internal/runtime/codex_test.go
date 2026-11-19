package runtime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodexProbeAndModelDiscovery(t *testing.T) {
	binDir := t.TempDir()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then echo \"codex 9.9.9\"; exit 0; fi\n" +
		"if [ \"$1\" = \"--help\" ]; then echo \"commands: app-server exec\"; exit 0; fi\n" +
		"exit 1\n"
	if err := os.WriteFile(filepath.Join(binDir, "codex"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake codex: %v", err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	configDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte("model = \"gpt-5.5\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("CODEX_HOME", configDir)
	codexProbeCache.Delete("codex")

	probe := (&CodexAdapter{}).Probe(context.Background())
	if !probe.Compatible || !probe.Capabilities["app-server"] {
		t.Fatalf("probe = %#v", probe)
	}
	if len(probe.Models) != 1 || probe.Models[0].ID != "gpt-5.5" || !probe.Models[0].Default {
		t.Fatalf("models = %#v", probe.Models)
	}
}

func TestExecDriverBuildsArgsAndStreamsOutput(t *testing.T) {
	binDir := t.TempDir()
	argsFile := filepath.Join(binDir, "args.txt")
	script := "#!/bin/sh\n" +
		"echo \"$@\" > " + argsFile + "\n" +
		"echo 'exec output'\n"
	if err := os.WriteFile(filepath.Join(binDir, "fake-exec"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake exec: %v", err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	manifest := Manifest{
		ID: "fake-exec", Executable: "fake-exec", Transport: TransportExec,
		ExecArgs:           []string{"exec"},
		ExecPermissionFlag: "--sandbox",
		PermissionModes:    PermissionMapping{ReadOnly: "read-only", ControlledEdit: "workspace-write", FullAccess: "danger-full-access"},
	}
	driver, _ := NewDriver(manifest)
	emit, events := collectEventsConcurrent()
	if err := driver.Run(context.Background(), SessionRequest{Manifest: manifest, Request: Request{
		Prompt: "hello", Workdir: t.TempDir(), PermissionMode: "read_only",
	}}, emit); err != nil {
		t.Fatalf("run: %v", err)
	}
	args, _ := os.ReadFile(argsFile)
	if !strings.Contains(string(args), "exec --sandbox read-only hello") {
		t.Fatalf("args = %s", args)
	}
	types := map[string]bool{}
	for _, event := range *events {
		types[event.Type] = true
	}
	if !types["log"] || !types["done"] {
		t.Fatalf("events = %v", types)
	}
}

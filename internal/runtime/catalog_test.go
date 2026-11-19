package runtime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuiltinManifestsAreComplete(t *testing.T) {
	seen := map[string]bool{}
	for _, manifest := range Manifests() {
		if manifest.ID == "" || manifest.Executable == "" {
			t.Fatalf("manifest missing id or executable: %#v", manifest)
		}
		if seen[manifest.ID] {
			t.Fatalf("duplicate manifest id %q", manifest.ID)
		}
		seen[manifest.ID] = true
		if manifest.Transport == "" {
			t.Fatalf("manifest %q missing transport", manifest.ID)
		}
	}
	claude, ok := ManifestFor("claude")
	if !ok {
		t.Fatal("claude manifest missing")
	}
	if claude.Transport != TransportStreamJSON || claude.PermissionFlag("read_only") != "plan" {
		t.Fatalf("claude manifest = %#v", claude)
	}
	if claude.PermissionFlag("full_access") != "bypassPermissions" {
		t.Fatalf("full access flag = %q", claude.PermissionFlag("full_access"))
	}
	if claude.PermissionFlag("controlled_edit") != "acceptEdits" {
		t.Fatalf("controlled edit flag = %q", claude.PermissionFlag("controlled_edit"))
	}
	if _, ok := ManifestFor("nope"); ok {
		t.Fatal("unknown manifest must not resolve")
	}
	if TransportFor("mock") != "builtin" || TransportFor("nope") != "unknown" {
		t.Fatalf("transport fallbacks are wrong")
	}
}

func TestNewDriverRejectsUnknownTransport(t *testing.T) {
	for _, transport := range []Transport{TransportStreamJSON, TransportACP, TransportAppServer, TransportExec} {
		driver, ok := NewDriver(Manifest{Transport: transport})
		if !ok || driver.Transport() != transport {
			t.Fatalf("driver missing for transport %q", transport)
		}
	}
	if _, ok := NewDriver(Manifest{Transport: "nope"}); ok {
		t.Fatal("unknown transport must not resolve")
	}
}

// TestStreamJSONDriverUsesManifestArgs proves the driver takes its argv
// contract from the manifest instead of hardcoding a CLI name.
func TestStreamJSONDriverUsesManifestArgs(t *testing.T) {
	binDir := t.TempDir()
	argsFile := filepath.Join(binDir, "args.txt")
	script := "#!/bin/sh\n" +
		"echo \"$@\" > " + argsFile + "\n" +
		"echo '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"ok\"}'\n"
	if err := os.WriteFile(filepath.Join(binDir, "customcli"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake CLI: %v", err)
	}
	t.Setenv("PATH", binDir)

	manifest := Manifest{
		ID:                      "custom",
		Executable:              "customcli",
		Transport:               TransportStreamJSON,
		PermissionModes:         PermissionMapping{ReadOnly: "plan", ControlledEdit: "edit", FullAccess: "full"},
		PromptFlag:              "-p",
		OutputFormat:            "stream-json",
		VerboseFlag:             true,
		DisallowedToolsReadOnly: []string{"Write", "Bash"},
	}
	driver, ok := NewDriver(manifest)
	if !ok {
		t.Fatal("driver missing")
	}
	emit, _ := collectEvents()
	err := driver.Run(context.Background(), SessionRequest{
		Manifest: manifest,
		Request: Request{
			Prompt:         "hello",
			Workdir:        t.TempDir(),
			Model:          "m1",
			PermissionMode: "read_only",
		},
	}, emit)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	joined := string(args)
	for _, want := range []string{"-p hello", "--output-format stream-json", "--verbose", "--model m1", "--permission-mode plan", "--disallowedTools Write,Bash"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args missing %q: %s", want, joined)
		}
	}
}

package runtime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLIInventoryMergesManifestsAndDetection(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(home, ".claude"))
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude", "settings.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	binDir := t.TempDir()
	claudeScript := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then echo \"claude 9.9.9\"; exit 0; fi\n" +
		"if [ \"$1\" = \"auth\" ]; then echo '{\"loggedIn\":true,\"authMethod\":\"oauth\",\"apiProvider\":\"firstParty\"}'; exit 0; fi\n" +
		"exit 0\n"
	if err := os.WriteFile(filepath.Join(binDir, "claude"), []byte(claudeScript), 0o755); err != nil {
		t.Fatal(err)
	}
	opencodeScript := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then echo \"opencode 9.9.9\"; exit 0; fi\n" +
		"if [ \"$1\" = \"models\" ]; then exit 0; fi\n" +
		"if [ \"$1\" = \"auth\" ]; then echo \"OpenCode Go  Go  stored\"; exit 0; fi\n" +
		"exit 0\n"
	if err := os.WriteFile(filepath.Join(binDir, "opencode"), []byte(opencodeScript), 0o755); err != nil {
		t.Fatal(err)
	}
	geminiScript := "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo \"gemini 9.9.9\"; exit 0; fi\nexit 0\n"
	if err := os.WriteFile(filepath.Join(binDir, "gemini"), []byte(geminiScript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)

	inventory := CLIInventory(context.Background(), map[string]bool{"claude": true, "opencode": true, "codex": true})
	byID := map[string]CLIInfo{}
	for _, info := range inventory {
		byID[info.ID] = info
	}

	claude := byID["claude"]
	if !claude.Installed || !claude.Supported || claude.Version != "claude 9.9.9" {
		t.Fatalf("claude = %#v", claude)
	}
	if !claude.ConfigPresent || !claude.AuthPresent {
		t.Fatalf("claude config/auth flags = %#v", claude)
	}
	if !claude.LoginChecked || !claude.LoggedIn || claude.AuthMethod != "oauth" {
		t.Fatalf("claude login status = %#v", claude)
	}
	if !strings.HasSuffix(claude.ConfigPath, filepath.Join(".claude", "settings.json")) {
		t.Fatalf("claude config path = %q", claude.ConfigPath)
	}

	codex := byID["codex"]
	if codex.Installed || !codex.Supported || codex.InstallCommand == "" {
		t.Fatalf("codex = %#v", codex)
	}
	if codex.ConfigPath == "" || codex.AuthPath == "" {
		t.Fatalf("codex paths = %#v", codex)
	}

	gemini := byID["gemini"]
	if !gemini.Installed || gemini.Supported || gemini.Transport != "" {
		t.Fatalf("gemini extra = %#v", gemini)
	}

	opencode := byID["opencode"]
	if !opencode.LoginChecked || !opencode.LoggedIn || len(opencode.Providers) != 1 {
		t.Fatalf("opencode login status = %#v", opencode)
	}
}

package runtime

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestAccountProfileCreatesIsolatedEnv(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	manifest, _ := ManifestFor("claude")
	env, dirs, err := AccountProfileEnv(manifest, "work")
	if err != nil {
		t.Fatalf("account env: %v", err)
	}
	base := filepath.Join(home, ".ateam", "accounts", "claude", "work")
	if env["CLAUDE_CONFIG_DIR"] != base {
		t.Fatalf("CLAUDE_CONFIG_DIR = %q", env["CLAUDE_CONFIG_DIR"])
	}
	if len(dirs) != 1 || dirs[0] != base {
		t.Fatalf("dirs = %#v", dirs)
	}
	profiles := ListAccountProfiles(manifest)
	if len(profiles) != 1 || profiles[0].Name != "work" {
		t.Fatalf("profiles = %#v", profiles)
	}
	if !strings.Contains(profiles[0].LoginCommand, "CLAUDE_CONFIG_DIR=") {
		t.Fatalf("login command = %q", profiles[0].LoginCommand)
	}

	opencode, _ := ManifestFor("opencode")
	env, dirs, err = AccountProfileEnv(opencode, "personal")
	if err != nil {
		t.Fatalf("opencode account env: %v", err)
	}
	for _, key := range []string{"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"} {
		if env[key] == "" {
			t.Fatalf("missing %s: %#v", key, env)
		}
	}
	if len(dirs) != 5 {
		t.Fatalf("opencode dirs = %#v", dirs)
	}
}

func TestAccountProfileRejectsUnsafeNames(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	manifest, _ := ManifestFor("claude")
	for _, name := range []string{"../escape", "a/b", `a\b`, ".."} {
		if _, _, err := AccountProfileEnv(manifest, name); err == nil {
			t.Fatalf("name %q must be rejected", name)
		}
	}
}

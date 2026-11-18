package runtime

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverClaudeModelsReadsPickerAndEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	body := `{
	  "modelPicker": {
	    "options": [
	      {"model": "ccs-claude-deepseek--deepseek-flash[1M]", "label": "deepseek-flash（DeepSeek）"},
	      {"model": "ccs-claude-glm--glm-5.3[1M]", "label": "glm-5.3（GLM）"}
	    ]
	  },
	  "env": {
	    "ANTHROPIC_MODEL": "ccs-claude-deepseek--deepseek-flash[1M]",
	    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "ccs-claude-minimax--MiniMax-M3[1M]",
	    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "MiniMax-M3"
	  }
	}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	models := discoverClaudeModels(path)
	if len(models) != 3 {
		t.Fatalf("models = %#v, want 3 deduplicated entries", models)
	}
	byID := map[string]Model{}
	for _, model := range models {
		byID[model.ID] = model
	}
	if model := byID["ccs-claude-deepseek--deepseek-flash[1M]"]; model.Label == "" || !model.Default {
		t.Fatalf("deepseek model = %#v, want label and default", model)
	}
	if model := byID["ccs-claude-minimax--MiniMax-M3[1M]"]; model.Label != "MiniMax-M3" {
		t.Fatalf("minimax model = %#v, want env label", model)
	}
	if models[0].Source != ModelSourceSettings {
		t.Fatalf("source = %q", models[0].Source)
	}
}

func TestDetectInstalledParsesHarnessModels(t *testing.T) {
	binDir := t.TempDir()
	writeScript := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(binDir, name), []byte("#!/bin/sh\n"+body), 0o755); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	writeScript("opencode", `if [ "$1" = "--version" ]; then echo "opencode 2.3.2"; exit 0; fi
if [ "$1" = "models" ]; then printf 'deepseek/deepseek-flash\nglm/glm-5.3\n'; exit 0; fi
exit 1`)
	writeScript("cursor-agent", `if [ "$1" = "--version" ]; then echo "2026.01.23"; exit 0; fi
if [ "$1" = "models" ]; then printf '\033[2KLoading models…\n\033[2KNo models available for this account.\n'; exit 0; fi
exit 1`)
	t.Setenv("PATH", binDir)

	harnesses := DetectInstalled(context.Background())
	byName := map[string]HarnessInfo{}
	for _, harness := range harnesses {
		byName[harness.Name] = harness
	}
	opencode, ok := byName["opencode"]
	if !ok || opencode.Version != "opencode 2.3.2" || len(opencode.Models) != 2 {
		t.Fatalf("opencode = %#v", opencode)
	}
	cursor, ok := byName["cursor-agent"]
	if !ok || cursor.Version != "2026.01.23" {
		t.Fatalf("cursor = %#v", cursor)
	}
	if cursor.ModelsError == "" {
		t.Fatalf("cursor should report no models: %#v", cursor)
	}
}

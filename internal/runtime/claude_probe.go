package runtime

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const claudeProbeTTL = 60 * time.Second

// Probe verifies the CLI is installed, records its version, and checks that
// the required flags are advertised by --help. Results are cached in memory
// per process (M1-RUNTIME-001: no machine capability table in M1).
func (a *ClaudeAdapter) Probe(ctx context.Context) ProbeInfo {
	if cached, ok := claudeProbeCache.Load("claude"); ok {
		entry := cached.(claudeProbeCacheEntry)
		if time.Since(entry.at) < claudeProbeTTL {
			return entry.info
		}
	}
	info := probeClaude(ctx)
	claudeProbeCache.Store("claude", claudeProbeCacheEntry{info: info, at: time.Now()})
	return info
}

type claudeProbeCacheEntry struct {
	info ProbeInfo
	at   time.Time
}

var claudeProbeCache sync.Map

var requiredClaudeFlags = claudeProbeFlags()

func claudeProbeFlags() []string {
	if manifest, ok := ManifestFor("claude"); ok && len(manifest.RequiredProbeFlags) > 0 {
		return manifest.RequiredProbeFlags
	}
	return []string{"--output-format", "--permission-mode", "--verbose"}
}

func probeClaude(ctx context.Context) ProbeInfo {
	info := ProbeInfo{Name: "claude", Capabilities: map[string]bool{}}
	path, err := exec.LookPath("claude")
	if err != nil {
		info.Detail = "claude CLI not found in PATH; install it or add it to PATH"
		return info
	}

	versionOutput, err := runProbeCommand(ctx, path, "--version")
	if err != nil {
		info.Detail = "claude --version failed; the CLI may be broken"
		return info
	}
	info.Version = firstVersionToken(versionOutput)

	helpOutput, err := runProbeCommand(ctx, path, "--help")
	if err != nil {
		info.Detail = "claude --help failed; cannot verify the required flags"
		return info
	}
	missing := []string{}
	for _, flag := range requiredClaudeFlags {
		supported := strings.Contains(helpOutput, flag)
		info.Capabilities[flag] = supported
		if !supported {
			missing = append(missing, flag)
		}
	}
	if len(missing) > 0 {
		info.Detail = "claude CLI is missing required flags: " + strings.Join(missing, ", ") + "; upgrade the CLI"
		return info
	}
	info.Compatible = true
	// claude --help does not enumerate models, but Claude Code stores the
	// configured model aliases in settings.json. Surface those local IDs
	// without reading credentials (PRD §6.4.1).
	info.Models = discoverClaudeModels("")
	if len(info.Models) == 0 {
		info.ModelsError = "claude CLI does not expose a model list; add local models in Settings"
	}
	return info
}

type claudeModelOption struct {
	Model string `json:"model"`
	Label string `json:"label"`
}

type claudeSettings struct {
	Env         map[string]string `json:"env"`
	ModelPicker struct {
		Options []claudeModelOption `json:"options"`
	} `json:"modelPicker"`
}

var claudeModelEnvKeys = []string{
	"ANTHROPIC_MODEL",
	"ANTHROPIC_DEFAULT_FABLE_MODEL",
	"ANTHROPIC_DEFAULT_OPUS_MODEL",
	"ANTHROPIC_DEFAULT_SONNET_MODEL",
	"ANTHROPIC_DEFAULT_HAIKU_MODEL",
	"ANTHROPIC_SMALL_FAST_MODEL",
}

// discoverClaudeModels merges modelPicker options and ANTHROPIC_* model
// aliases from Claude Code's local settings. An explicit configPath is used
// by tests; production resolves CLAUDE_CONFIG_DIR or ~/.claude/settings.json.
func discoverClaudeModels(configPath string) []Model {
	if configPath == "" {
		configPath = claudeSettingsPath()
	}
	settings := claudeSettings{Env: map[string]string{}}
	if body, err := os.ReadFile(configPath); err == nil {
		_ = json.Unmarshal(body, &settings)
	}
	models := []Model{}
	seen := map[string]bool{}
	add := func(id, label string, isDefault bool) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if seen[id] {
			for index := range models {
				if models[index].ID != id {
					continue
				}
				if label != "" && models[index].Label == "" {
					models[index].Label = strings.TrimSpace(label)
				}
				if isDefault {
					models[index].Default = true
				}
			}
			return
		}
		seen[id] = true
		models = append(models, Model{
			ID:      id,
			Label:   strings.TrimSpace(label),
			Source:  ModelSourceSettings,
			Default: isDefault,
			Status:  ModelStatusUnverified,
		})
	}
	for _, option := range settings.ModelPicker.Options {
		add(option.Model, option.Label, false)
	}
	for _, key := range claudeModelEnvKeys {
		value := strings.TrimSpace(settings.Env[key])
		if value == "" {
			value = strings.TrimSpace(os.Getenv(key))
		}
		add(value, settings.Env[key+"_NAME"], key == "ANTHROPIC_MODEL")
	}
	return models
}

func claudeSettingsPath() string {
	if dir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); dir != "" {
		return filepath.Join(dir, "settings.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".claude", "settings.json")
}

func runProbeCommand(parent context.Context, path string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, probeTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, args...).Output()
	if err != nil {
		return "", err
	}
	return string(output), nil
}

func firstVersionToken(output string) string {
	line := strings.TrimSpace(output)
	if line == "" {
		return "unknown"
	}
	for _, token := range strings.Fields(line) {
		trimmed := strings.TrimPrefix(token, "v")
		if strings.ContainsAny(trimmed, "0123456789") && strings.Count(trimmed, ".") >= 1 {
			return trimmed
		}
	}
	return strings.Fields(line)[0]
}

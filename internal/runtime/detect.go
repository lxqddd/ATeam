package runtime

import (
	"context"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// HarnessInfo describes an installed coding-agent CLI that ATeam can detect
// even when it does not yet have an execution adapter. The UI lists these as
// runtimes but keeps them disabled until an adapter is registered.
type HarnessInfo struct {
	Name        string
	Path        string
	Version     string
	Models      []Model
	ModelsError string
}

type harnessSpec struct {
	Name       string
	ModelsArgs []string
}

var knownHarnesses = []harnessSpec{
	{Name: "claude"},
	{Name: "codex"},
	{Name: "opencode", ModelsArgs: []string{"models"}},
	{Name: "cursor-agent", ModelsArgs: []string{"models"}},
	{Name: "gemini"},
	{Name: "qwen"},
	{Name: "aider"},
}

var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)

// DetectInstalled scans PATH for known harness CLIs and probes their version
// and, when the CLI exposes it, their local model list. It never reads
// credentials and never starts an agent session.
func DetectInstalled(ctx context.Context) []HarnessInfo {
	detected := make([]HarnessInfo, 0)
	for _, spec := range knownHarnesses {
		path, err := exec.LookPath(spec.Name)
		if err != nil {
			continue
		}
		info := HarnessInfo{Name: spec.Name, Path: path, Models: []Model{}}
		if output, err := runHarnessCommand(ctx, path, "--version"); err == nil {
			info.Version = firstHarnessLine(output)
		}
		if len(spec.ModelsArgs) > 0 {
			output, err := runHarnessCommand(ctx, path, spec.ModelsArgs...)
			if err != nil {
				info.ModelsError = spec.Name + " did not return a model list"
			} else {
				info.Models, info.ModelsError = parseHarnessModels(output)
			}
		}
		detected = append(detected, info)
	}
	return detected
}

func runHarnessCommand(parent context.Context, path string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, args...).Output()
	if err != nil {
		return "", err
	}
	return string(output), nil
}

func parseHarnessModels(output string) ([]Model, string) {
	models := []Model{}
	seen := map[string]bool{}
	modelsError := ""
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(stripANSI(raw))
		if line == "" || strings.HasPrefix(line, "Loading") {
			continue
		}
		if strings.Contains(strings.ToLower(line), "no models available") {
			modelsError = line
			continue
		}
		if len(line) > 200 || seen[line] {
			continue
		}
		seen[line] = true
		models = append(models, Model{
			ID:     line,
			Label:  line,
			Source: ModelSourceRuntime,
			Status: ModelStatusAvailable,
		})
	}
	if len(models) == 0 && modelsError == "" {
		modelsError = "the harness did not report any models"
	}
	return models, modelsError
}

func stripANSI(value string) string {
	return ansiPattern.ReplaceAllString(strings.ReplaceAll(value, "\r", ""), "")
}

func firstHarnessLine(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(stripANSI(line))
		if line != "" {
			if len(line) > 120 {
				line = line[:120]
			}
			return line
		}
	}
	return ""
}

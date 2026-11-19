package runtime

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// CodexAdapter runs the local `codex` CLI through its app-server JSON-RPC
// transport, falling back to `codex exec` only when app-server is not
// available in the installed version.
type CodexAdapter struct{}

func (a *CodexAdapter) Name() string { return "codex" }

var codexProbeCache sync.Map

type codexProbeEntry struct {
	info ProbeInfo
	at   time.Time
}

func (a *CodexAdapter) Probe(ctx context.Context) ProbeInfo {
	if cached, ok := codexProbeCache.Load("codex"); ok {
		entry := cached.(codexProbeEntry)
		if time.Since(entry.at) < 60*time.Second {
			return entry.info
		}
	}
	info := a.probe(ctx)
	codexProbeCache.Store("codex", codexProbeEntry{info: info, at: time.Now()})
	return info
}

func (a *CodexAdapter) probe(ctx context.Context) ProbeInfo {
	info := ProbeInfo{Name: "codex", Capabilities: map[string]bool{"streaming": true, "tools": true}}
	path, err := exec.LookPath("codex")
	if err != nil {
		info.Detail = "codex CLI not found in PATH"
		return info
	}
	versionCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	if output, err := exec.CommandContext(versionCtx, path, "--version").Output(); err == nil {
		info.Version = strings.TrimSpace(string(output))
	}
	helpCtx, cancelHelp := context.WithTimeout(ctx, probeTimeout)
	defer cancelHelp()
	help, _ := exec.CommandContext(helpCtx, path, "--help").CombinedOutput()
	helpText := string(help)
	info.Capabilities["app-server"] = strings.Contains(helpText, "app-server")
	info.Capabilities["exec"] = strings.Contains(helpText, "exec")
	if !info.Capabilities["app-server"] && !info.Capabilities["exec"] {
		info.Detail = "codex CLI does not expose app-server or exec"
		return info
	}
	info.Compatible = true
	info.Models, info.ModelsError = discoverCodexModels()
	return info
}

var codexModelLine = regexp.MustCompile(`(?m)^\s*model\s*=\s*"([^"]+)"`)

func discoverCodexModels() ([]Model, string) {
	root := os.Getenv("CODEX_HOME")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, "cannot locate the Codex config directory"
		}
		root = filepath.Join(home, ".codex")
	}
	data, err := os.ReadFile(filepath.Join(root, "config.toml"))
	if err != nil {
		return nil, "codex does not enumerate models; configure one locally"
	}
	match := codexModelLine.FindSubmatch(data)
	if len(match) < 2 || strings.TrimSpace(string(match[1])) == "" {
		return nil, "codex does not enumerate models; configure one locally"
	}
	model := strings.TrimSpace(string(match[1]))
	return []Model{{
		ID: model, Source: ModelSourceSettings, Default: true, Status: ModelStatusUnverified,
	}}, ""
}

// Run prefers app-server and falls back to exec only when no event was
// emitted (older CLI without the subcommand).
func (a *CodexAdapter) Run(ctx context.Context, req Request, emit func(Event)) error {
	manifest, ok := ManifestFor("codex")
	if !ok {
		return &Error{Detail: "adapter_crash", Message: "codex manifest is not registered"}
	}
	if _, err := exec.LookPath(manifest.Executable); err != nil {
		return &Error{Detail: "runtime_missing", Message: manifest.Executable + " CLI not found in PATH"}
	}
	probe := a.Probe(ctx)
	if !probe.Compatible {
		return &Error{Detail: "runtime_version_unsupported", Message: probe.Detail}
	}
	driver, ok := NewDriver(manifest)
	if ok {
		emitted := false
		err := driver.Run(ctx, SessionRequest{Manifest: manifest, Request: req}, func(event Event) {
			if !(event.Type == "log" && event.Source == "stderr") {
				emitted = true
			}
			emit(event)
		})
		if err == nil || emitted || ctx.Err() != nil {
			return err
		}
		emit(Event{Type: "status", Message: "app-server unavailable; falling back to codex exec", Source: "adapter", Level: "warn"})
	}
	fallback, ok := NewDriver(Manifest{
		ID: manifest.ID, DisplayName: manifest.DisplayName, Executable: manifest.Executable,
		Transport: TransportExec, ExecArgs: manifest.ExecArgs, ExecPermissionFlag: manifest.ExecPermissionFlag,
		PermissionModes: manifest.PermissionModes, ModelLaunchConfig: manifest.ModelLaunchConfig,
	})
	if !ok {
		return &Error{Detail: "adapter_crash", Message: "no exec fallback for codex"}
	}
	return fallback.Run(ctx, SessionRequest{Manifest: manifest, Request: req}, emit)
}

package runtime

import (
	"context"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Probe verifies the CLI is installed, records its version, and checks that
// the required flags are advertised by --help. Results are cached in memory
// per process (M1-RUNTIME-001: no machine capability table in M1).
func (a *ClaudeAdapter) Probe(ctx context.Context) ProbeInfo {
	if cached, ok := claudeProbeCache.Load("claude"); ok {
		entry := cached.(claudeProbeCacheEntry)
		if time.Since(entry.at) < 5*time.Minute {
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

var requiredClaudeFlags = []string{"--output-format", "--permission-mode", "--verbose"}

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
	return info
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

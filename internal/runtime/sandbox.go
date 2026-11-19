package runtime

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	SandboxModeNone     = "none"
	SandboxModeSeatbelt = "seatbelt"
)

// SeatbeltAvailable reports whether the macOS sandbox launcher exists.
func SeatbeltAvailable() bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	_, err := os.Stat("/usr/bin/sandbox-exec")
	return err == nil
}

// wrapSandbox replaces the command with `sandbox-exec -p <profile> -- …`
// when the run requested the seatbelt mode. It never silently downgrades: a
// missing sandbox returns sandbox_unavailable so the scheduler can fail
// closed or apply the explicitly configured fallback.
func wrapSandbox(manifest Manifest, req Request, path string, args []string) (string, []string, error) {
	if req.SandboxMode != SandboxModeSeatbelt {
		return path, args, nil
	}
	if !SeatbeltAvailable() {
		return "", nil, &Error{Detail: "sandbox_unavailable", Message: "macOS Seatbelt sandbox is not available"}
	}
	profile := SeatbeltProfile(manifest, req, path)
	wrapped := []string{"-p", profile, "--", path}
	wrapped = append(wrapped, args...)
	return "/usr/bin/sandbox-exec", wrapped, nil
}

// SeatbeltProfile builds a deny-by-default-write profile: reads are allowed
// except for known credential stores, writes only inside the run worktree,
// temp directories and the CLI's own state directories. Network and process
// execution stay allowed so model calls and tool subprocesses work.
func SeatbeltProfile(manifest Manifest, req Request, extraReadPaths ...string) string {
	home, _ := os.UserHomeDir()
	var builder strings.Builder
	builder.WriteString("(version 1)\n")
	builder.WriteString("(deny default)\n")
	builder.WriteString("(allow process*)\n")
	builder.WriteString("(allow signal)\n")
	builder.WriteString("(allow sysctl-read)\n")
	builder.WriteString("(allow mach-lookup)\n")
	builder.WriteString("(allow network*)\n")

	// Reads: system runtime, the worktree, temp and the CLI's own config.
	// Credential stores under the home directory are deliberately omitted.
	reads := []string{
		"/usr", "/System", "/Library", "/bin", "/sbin", "/opt", "/Applications",
		"/private/etc", "/private/var", "/private/var/db", "/private/var/folders", "/private/var/tmp",
		"/private/tmp", "/dev", "/tmp", "/etc", "/var", "/var/folders", "/var/tmp",
		req.Workdir,
	}
	for _, path := range extraReadPaths {
		if path != "" {
			reads = append(reads, path, filepath.Dir(path))
		}
	}
	reads = append(reads, cliStatePaths(manifest, home)...)
	reads = append(reads, req.AccountDirs...)
	builder.WriteString("(allow file-read*\n")
	builder.WriteString("  (literal " + seatbeltQuote("/") + ")\n")
	for _, path := range dedupePaths(reads) {
		builder.WriteString("  " + seatbeltMatch(path) + "\n")
	}
	builder.WriteString(")\n")

	writes := []string{
		req.Workdir,
		"/private/tmp", "/private/var/folders", "/private/var/tmp", "/tmp", "/var/folders",
	}
	writes = append(writes, cliStatePaths(manifest, home)...)
	writes = append(writes, req.AccountDirs...)
	builder.WriteString("(allow file-write*\n")
	for _, path := range dedupePaths(writes) {
		builder.WriteString("  " + seatbeltMatch(path) + "\n")
	}
	for _, path := range []string{"/dev/null", "/dev/tty", "/dev/stdout", "/dev/stderr"} {
		builder.WriteString("  (literal " + seatbeltQuote(path) + ")\n")
	}
	builder.WriteString(")\n")
	return builder.String()
}

// seatbeltMatch emits a literal for file paths and a subpath for
// directories. SBPL has no stat at profile-build time, so a trailing
// extension is the practical distinction (all CLI state files are JSON).
func seatbeltMatch(path string) string {
	if strings.HasSuffix(path, ".json") || strings.HasSuffix(path, ".toml") {
		return "(literal " + seatbeltQuote(path) + ")"
	}
	return "(subpath " + seatbeltQuote(path) + ")"
}

func cliStatePaths(manifest Manifest, home string) []string {
	switch manifest.ID {
	case "claude":
		return []string{
			filepath.Join(home, ".claude"),
			filepath.Join(home, ".claude.json"),
			filepath.Join(home, ".cache"),
			filepath.Join(home, "Library", "Caches"),
		}
	case "opencode":
		return []string{
			filepath.Join(home, ".config", "opencode"),
			filepath.Join(home, ".local", "share", "opencode"),
			filepath.Join(home, ".local", "state", "opencode"),
			filepath.Join(home, ".cache", "opencode"),
		}
	case "codex":
		return []string{
			filepath.Join(home, ".codex"),
			filepath.Join(home, ".cache"),
		}
	default:
		return []string{
			filepath.Join(home, ".cache"),
			filepath.Join(home, ".config"),
			filepath.Join(home, ".local", "share"),
		}
	}
}

func dedupePaths(paths []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		result = append(result, path)
	}
	return result
}

func seatbeltQuote(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return `"` + value + `"`
}

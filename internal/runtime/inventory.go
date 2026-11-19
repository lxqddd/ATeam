package runtime

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// CLIInfo is the machine-readable inventory used by Runtime management to
// show what is installed, how to install it, and where its local config
// lives. It never exposes credentials or token contents.
type CLIInfo struct {
	ID              string               `json:"id"`
	DisplayName     string               `json:"displayName"`
	Executable      string               `json:"executable"`
	Path            string               `json:"path,omitempty"`
	Version         string               `json:"version,omitempty"`
	Transport       string               `json:"transport,omitempty"`
	Supported       bool                 `json:"supported"`
	Installed       bool                 `json:"installed"`
	NpmPackage      string               `json:"npmPackage,omitempty"`
	InstallCommand  string               `json:"installCommand,omitempty"`
	ConfigPath      string               `json:"configPath,omitempty"`
	AuthPath        string               `json:"authPath,omitempty"`
	ConfigPresent   bool                 `json:"configPresent"`
	AuthPresent     bool                 `json:"authPresent"`
	LoginChecked    bool                 `json:"loginChecked"`
	LoggedIn        bool                 `json:"loggedIn"`
	AuthMethod      string               `json:"authMethod,omitempty"`
	Providers       []string             `json:"providers,omitempty"`
	LoginCommand    string               `json:"loginCommand,omitempty"`
	AccountRoot     string               `json:"accountRoot,omitempty"`
	AccountProfiles []AccountProfileInfo `json:"accountProfiles,omitempty"`
}

// CLIInventory merges the built-in manifests with PATH detection. supported
// comes from the adapter registry; detected-but-unadapted CLIs stay visible
// with supported=false.
func CLIInventory(ctx context.Context, supported map[string]bool) []CLIInfo {
	detected := map[string]HarnessInfo{}
	for _, harness := range DetectInstalled(ctx) {
		detected[harness.Name] = harness
	}
	infos := make([]CLIInfo, 0, len(Manifests())+len(detected))
	seen := map[string]bool{}
	for _, manifest := range Manifests() {
		info := CLIInfo{
			ID:             manifest.ID,
			DisplayName:    manifest.DisplayName,
			Executable:     manifest.Executable,
			Transport:      string(manifest.Transport),
			Supported:      supported[manifest.ID],
			NpmPackage:     manifest.NpmPackage,
			InstallCommand: manifest.InstallCommand,
			LoginCommand:   manifest.LoginCommand,
		}
		if harness, ok := detected[manifest.ID]; ok {
			info.Installed = true
			info.Path = harness.Path
			info.Version = harness.Version
		} else if path, err := exec.LookPath(manifest.Executable); err == nil {
			info.Installed = true
			info.Path = path
		}
		info.ConfigPath, info.AuthPath = resolveCLIPaths(manifest)
		info.ConfigPresent = pathExists(info.ConfigPath)
		info.AuthPresent = pathExists(info.AuthPath)
		if info.Installed {
			info.LoginChecked, info.LoggedIn, info.AuthMethod, info.Providers = probeAccount(ctx, manifest, info.Path)
		}
		info.AccountRoot = AccountProfileRoot()
		info.AccountProfiles = ListAccountProfiles(manifest)
		infos = append(infos, info)
		seen[manifest.ID] = true
	}
	extras := make([]CLIInfo, 0)
	for name, harness := range detected {
		if seen[name] {
			continue
		}
		extras = append(extras, CLIInfo{
			ID:          name,
			DisplayName: name,
			Executable:  name,
			Path:        harness.Path,
			Version:     harness.Version,
			Supported:   supported[name],
			Installed:   true,
		})
	}
	sort.Slice(extras, func(i, j int) bool { return extras[i].ID < extras[j].ID })
	return append(infos, extras...)
}

func resolveCLIPaths(manifest Manifest) (string, string) {
	configPath := manifest.ConfigPath
	authPath := manifest.AuthPath
	switch manifest.ID {
	case "claude":
		if dir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); dir != "" {
			configPath = filepath.Join(dir, "settings.json")
		}
	case "codex":
		if dir := strings.TrimSpace(os.Getenv("CODEX_HOME")); dir != "" {
			configPath = filepath.Join(dir, "config.toml")
			authPath = filepath.Join(dir, "auth.json")
		}
	case "opencode":
		if dir := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); dir != "" {
			configPath = filepath.Join(dir, "opencode", "opencode.json")
		}
		if dir := strings.TrimSpace(os.Getenv("XDG_DATA_HOME")); dir != "" {
			authPath = filepath.Join(dir, "opencode", "auth.json")
		}
	}
	return expandHome(configPath), expandHome(authPath)
}

func expandHome(path string) string {
	if path == "" || !strings.HasPrefix(path, "~") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return path
	}
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Join(home, path[2:])
	}
	return path
}

func pathExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

// probeAccount asks the CLI for read-only login status. It never reads
// credential files or returns tokens; only booleans, the auth method and
// provider display names are kept.
func probeAccount(ctx context.Context, manifest Manifest, path string) (checked, loggedIn bool, method string, providers []string) {
	if path == "" {
		return false, false, "", nil
	}
	run := func(args ...string) ([]byte, error) {
		callCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		return exec.CommandContext(callCtx, path, args...).Output()
	}
	switch manifest.ID {
	case "claude":
		output, err := run("auth", "status")
		if err != nil {
			return false, false, "", nil
		}
		var status struct {
			LoggedIn    bool   `json:"loggedIn"`
			AuthMethod  string `json:"authMethod"`
			APIProvider string `json:"apiProvider"`
		}
		if err := json.Unmarshal(output, &status); err != nil {
			return false, false, "", nil
		}
		method = status.AuthMethod
		if method == "" && status.APIProvider != "" {
			method = status.APIProvider
		}
		return true, status.LoggedIn, method, nil
	case "opencode":
		output, err := run("auth", "list")
		if err != nil {
			return false, false, "", nil
		}
		seen := map[string]bool{}
		for _, raw := range strings.Split(string(output), "\n") {
			line := strings.TrimSpace(stripANSI(raw))
			if line == "" || len(line) > 120 {
				continue
			}
			if seen[line] {
				continue
			}
			seen[line] = true
			providers = append(providers, line)
			if len(providers) >= 10 {
				break
			}
		}
		return true, len(providers) > 0, "provider", providers
	default:
		return false, false, "", nil
	}
}

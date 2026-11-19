package runtime

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// AccountProfileRoot returns the ATeam-managed root for isolated CLI account
// profiles. Profiles contain only CLI config/state, never ATeam data.
func AccountProfileRoot() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".ateam", "accounts")
}

// AccountProfileInfo is one isolated CLI account profile.
type AccountProfileInfo struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	LoginCommand string `json:"loginCommand"`
}

// ListAccountProfiles lists profiles for one runtime. A profile is a
// directory under ~/.ateam/accounts/<runtime>/<name>.
func ListAccountProfiles(manifest Manifest) []AccountProfileInfo {
	root := AccountProfileRoot()
	if root == "" || manifest.ID == "" {
		return nil
	}
	entries, err := os.ReadDir(filepath.Join(root, manifest.ID))
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	profiles := make([]AccountProfileInfo, 0, len(names))
	for _, name := range names {
		profiles = append(profiles, AccountProfileInfo{
			Name:         name,
			Path:         filepath.Join(root, manifest.ID, name),
			LoginCommand: ProfileLoginCommand(manifest, name),
		})
	}
	return profiles
}

// AccountProfileEnv maps a profile name to the CLI-specific environment that
// isolates its config, state and cache. An empty profile returns nil (use the
// CLI's default account).
func AccountProfileEnv(manifest Manifest, profile string) (map[string]string, []string, error) {
	profile = strings.TrimSpace(profile)
	if profile == "" {
		return nil, nil, nil
	}
	if strings.ContainsAny(profile, `/\`) || profile == "." || profile == ".." {
		return nil, nil, &Error{Detail: "invalid_agent_config", Message: "invalid account profile name"}
	}
	root := AccountProfileRoot()
	if root == "" {
		return nil, nil, &Error{Detail: "invalid_agent_config", Message: "cannot locate the account profile root"}
	}
	base := filepath.Join(root, manifest.ID, profile)
	if err := os.MkdirAll(base, 0o700); err != nil {
		return nil, nil, &Error{Detail: "invalid_agent_config", Message: "cannot create the account profile directory"}
	}
	env := map[string]string{}
	dirs := []string{base}
	switch manifest.ID {
	case "claude":
		env["CLAUDE_CONFIG_DIR"] = base
	case "codex":
		env["CODEX_HOME"] = base
	case "opencode":
		configDir := filepath.Join(base, "config")
		dataDir := filepath.Join(base, "data")
		stateDir := filepath.Join(base, "state")
		cacheDir := filepath.Join(base, "cache")
		for _, dir := range []string{configDir, dataDir, stateDir, cacheDir} {
			if err := os.MkdirAll(dir, 0o700); err != nil {
				return nil, nil, &Error{Detail: "invalid_agent_config", Message: "cannot create the account profile directories"}
			}
			dirs = append(dirs, dir)
		}
		env["XDG_CONFIG_HOME"] = configDir
		env["XDG_DATA_HOME"] = dataDir
		env["XDG_STATE_HOME"] = stateDir
		env["XDG_CACHE_HOME"] = cacheDir
	default:
		return nil, nil, &Error{Detail: "invalid_agent_config", Message: "runtime does not support account profiles"}
	}
	return env, dirs, nil
}

// ProfileLoginCommand prints the terminal command that signs into a profile
// without touching the CLI's default account.
func ProfileLoginCommand(manifest Manifest, profile string) string {
	profile = strings.TrimSpace(profile)
	if profile == "" {
		return ""
	}
	root := AccountProfileRoot()
	if root == "" {
		return ""
	}
	base := filepath.Join(root, manifest.ID, profile)
	switch manifest.ID {
	case "claude":
		return "CLAUDE_CONFIG_DIR=" + shellQuote(base) + " claude auth login"
	case "codex":
		return "CODEX_HOME=" + shellQuote(base) + " codex login"
	case "opencode":
		return "XDG_CONFIG_HOME=" + shellQuote(filepath.Join(base, "config")) +
			" XDG_DATA_HOME=" + shellQuote(filepath.Join(base, "data")) +
			" XDG_STATE_HOME=" + shellQuote(filepath.Join(base, "state")) +
			" XDG_CACHE_HOME=" + shellQuote(filepath.Join(base, "cache")) +
			" opencode auth login"
	default:
		return ""
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

package runtime

// Manifest is the declarative description of one CLI harness. It is the
// single source for how ATeam launches and interprets a runtime, replacing
// per-adapter hardcoding (clean-room adaptation of the CLI-catalog pattern).
type Manifest struct {
	ID                string
	DisplayName       string
	Executable        string
	NpmPackage        string
	Transport         Transport
	FallbackTransport Transport
	PermissionModes   PermissionMapping
	// Session invocation contract.
	SessionArgs []string
	// Exec fallback invocation contract.
	ExecArgs           []string
	ExecPromptFlag     string
	ExecPermissionFlag string
	// ModelLaunchConfig, when set, passes the model to the CLI as
	// "-c <key>=\"value\"" before SessionArgs (Codex).
	ModelLaunchConfig string
	// StreamJSON invocation contract.
	PromptFlag              string
	OutputFormat            string
	VerboseFlag             bool
	DisallowedToolsReadOnly []string
	RequiredProbeFlags      []string
}

// Transport names the session protocol spoken between ATeam and the CLI.
type Transport string

const (
	TransportStreamJSON Transport = "stream-json"
	TransportACP        Transport = "acp"
	TransportAppServer  Transport = "app-server"
	TransportExec       Transport = "exec"
)

// PermissionMapping maps ATeam permission modes to the CLI's native mode
// value. An empty value means the CLI has no equivalent and the adapter must
// decide (or the run is refused).
type PermissionMapping struct {
	ReadOnly       string
	ControlledEdit string
	FullAccess     string
}

var builtinManifests = []Manifest{
	{
		ID:                "claude",
		DisplayName:       "Claude Code",
		Executable:        "claude",
		NpmPackage:        "@anthropic-ai/claude-code",
		Transport:         TransportStreamJSON,
		FallbackTransport: TransportExec,
		PermissionModes: PermissionMapping{
			ReadOnly:       "plan",
			ControlledEdit: "acceptEdits",
			FullAccess:     "bypassPermissions",
		},
		PromptFlag:              "-p",
		OutputFormat:            "stream-json",
		VerboseFlag:             true,
		DisallowedToolsReadOnly: []string{"Write", "Edit", "NotebookEdit", "Bash"},
		RequiredProbeFlags:      []string{"--output-format", "--permission-mode", "--verbose"},
		ExecPromptFlag:          "-p",
		ExecPermissionFlag:      "--permission-mode",
	},
	{
		ID:                "opencode",
		DisplayName:       "OpenCode",
		Executable:        "opencode",
		NpmPackage:        "@opencode/cli",
		Transport:         TransportACP,
		FallbackTransport: TransportExec,
		PermissionModes: PermissionMapping{
			ReadOnly:       "plan",
			ControlledEdit: "build",
			FullAccess:     "build",
		},
		SessionArgs:        []string{"acp"},
		ExecArgs:           []string{"run"},
		ExecPermissionFlag: "--agent",
	},
	{
		ID:                "codex",
		DisplayName:       "Codex",
		Executable:        "codex",
		NpmPackage:        "@openai/codex",
		Transport:         TransportAppServer,
		FallbackTransport: TransportExec,
		PermissionModes: PermissionMapping{
			ReadOnly:       "read-only",
			ControlledEdit: "workspace-write",
			FullAccess:     "danger-full-access",
		},
		SessionArgs:        []string{"app-server"},
		ExecArgs:           []string{"exec"},
		ExecPermissionFlag: "--sandbox",
		ModelLaunchConfig:  "model",
	},
}

// ManifestFor returns the built-in manifest with the given id.
func ManifestFor(id string) (Manifest, bool) {
	for _, manifest := range builtinManifests {
		if manifest.ID == id {
			return manifest, true
		}
	}
	return Manifest{}, false
}

// Manifests lists the built-in runtime manifests.
func Manifests() []Manifest {
	result := make([]Manifest, len(builtinManifests))
	copy(result, builtinManifests)
	return result
}

// PermissionFlag maps an ATeam permission mode to the CLI's native flag
// value, falling back to the controlled-edit mapping.
func (m Manifest) PermissionFlag(mode string) string {
	switch mode {
	case "read_only":
		return m.PermissionModes.ReadOnly
	case "full_access":
		return m.PermissionModes.FullAccess
	default:
		return m.PermissionModes.ControlledEdit
	}
}

// TransportFor reports the session transport a runtime uses. It is recorded
// in Run config snapshots so a run's protocol is reproducible.
func TransportFor(id string) string {
	if id == "mock" {
		return "builtin"
	}
	if manifest, ok := ManifestFor(id); ok {
		return string(manifest.Transport)
	}
	return "unknown"
}

package runtime

import (
	"context"
	"sort"
	"time"
)

type Event struct {
	Type    string         `json:"type"`
	Message string         `json:"message"`
	Data    map[string]any `json:"data,omitempty"`
	Source  string         `json:"source,omitempty"`
	Level   string         `json:"level,omitempty"`
}

type Request struct {
	Prompt         string
	Workdir        string
	Model          string
	PermissionMode string
	MaxTurns       int
	Policy         *Policy
}

// Adapter is the runtime boundary. Adapters map their CLI's output to Event.
type Adapter interface {
	Name() string
	Run(ctx context.Context, req Request, emit func(Event)) error
}

// Model is one selectable model in a runtime's local catalog. Source
// distinguishes models discovered from the CLI from models configured
// locally in ATeam (PRD runtime-and-workspace §6.4.1).
type Model struct {
	ID         string `json:"id"`
	Label      string `json:"label,omitempty"`
	Source     string `json:"source"`
	Default    bool   `json:"default"`
	Status     string `json:"status"`
	Deprecated bool   `json:"deprecated,omitempty"`
}

const (
	ModelSourceRuntime     = "runtime"
	ModelSourceSettings    = "settings"
	ModelStatusAvailable   = "available"
	ModelStatusUnverified  = "unverified"
	ModelStatusUnavailable = "unavailable"
)

// ProbeInfo is the cached capability probe result (M1-RUNTIME-001/007).
type ProbeInfo struct {
	Name         string
	Version      string
	Compatible   bool
	Detail       string
	Capabilities map[string]bool
	Models       []Model
	ModelsError  string
}

// Prober is implemented by adapters that can verify CLI availability,
// version and required flags before a run starts.
type Prober interface {
	Probe(ctx context.Context) ProbeInfo
}

// ModelTestResult is the outcome of a minimal model connectivity check.
type ModelTestResult struct {
	Latency time.Duration
	Reply   string
}

// ModelTester is implemented by adapters that can perform a minimal,
// read-only model request without creating a Run.
type ModelTester interface {
	TestModel(ctx context.Context, model string) (ModelTestResult, error)
}

// Error classifies a runtime failure so the scheduler can map it to a
// (errorCode, failureDetail) pair (PRD api-and-data §7.4).
type Error struct {
	Detail  string
	Message string
}

func (e *Error) Error() string { return e.Message }

type Registry struct {
	adapters map[string]Adapter
}

func NewRegistry() *Registry {
	registry := &Registry{adapters: make(map[string]Adapter)}
	registry.Register(&MockAdapter{})
	registry.Register(&ClaudeAdapter{})
	registry.Register(&OpenCodeAdapter{})
	return registry
}

// Register adds an adapter under its stable name. Core adapters are
// registered by NewRegistry; community adapters must be registered here in
// the core registry (PRD: third-party runtimes are not loaded through the
// M4 plugin API).
func (r *Registry) Register(adapter Adapter) {
	r.adapters[adapter.Name()] = adapter
}

// Get returns the adapter registered under name. Unknown runtimes fail
// explicitly instead of silently falling back to mock (MILE-009, D-M0-18).
func (r *Registry) Get(name string) (Adapter, bool) {
	adapter, ok := r.adapters[name]
	return adapter, ok
}

// Names lists the registered runtime names, sorted for stable output.
func (r *Registry) Names() []string {
	names := make([]string, 0, len(r.adapters))
	for name := range r.adapters {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

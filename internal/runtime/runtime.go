package runtime

import (
	"context"
	"sort"
)

type Event struct {
	Type    string         `json:"type"`
	Message string         `json:"message"`
	Data    map[string]any `json:"data,omitempty"`
}

type Request struct {
	Prompt  string
	Workdir string
}

type Adapter interface {
	Name() string
	Run(ctx context.Context, req Request, emit func(Event)) error
}

type Registry struct {
	adapters map[string]Adapter
}

func NewRegistry() *Registry {
	registry := &Registry{adapters: make(map[string]Adapter)}
	registry.Register(&MockAdapter{})
	registry.Register(&ClaudeAdapter{})
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

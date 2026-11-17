package runtime

import "context"

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
	registry.register(&MockAdapter{})
	registry.register(&ClaudeAdapter{})
	return registry
}

func (r *Registry) register(adapter Adapter) {
	r.adapters[adapter.Name()] = adapter
}

func (r *Registry) Get(name string) Adapter {
	if adapter, ok := r.adapters[name]; ok {
		return adapter
	}
	return r.adapters["mock"]
}

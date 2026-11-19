package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/store"
)

type runtimeModelView struct {
	ID         string `json:"id"`
	Label      string `json:"label,omitempty"`
	Source     string `json:"source"`
	Default    bool   `json:"default"`
	Status     string `json:"status"`
	Deprecated bool   `json:"deprecated,omitempty"`
}

type runtimeView struct {
	Name         string             `json:"name"`
	Available    bool               `json:"available"`
	Installed    bool               `json:"installed"`
	Supported    bool               `json:"supported"`
	Compatible   bool               `json:"compatible"`
	Version      string             `json:"version"`
	Detail       string             `json:"detail,omitempty"`
	Capabilities map[string]bool    `json:"capabilities,omitempty"`
	Models       []runtimeModelView `json:"models"`
	DefaultModel string             `json:"defaultModel"`
	ModelsError  string             `json:"modelsError,omitempty"`
}

// runtimeProbeView builds the model catalog discovered by probing the runtime
// itself, without the installation's local settings entries.
func (a *API) runtimeProbeView(ctx context.Context, name string) (runtimeView, bool) {
	adapter, ok := a.registry.Get(name)
	if !ok {
		return runtimeView{}, false
	}
	info := runtime.ProbeInfo{Name: name, Version: "builtin", Compatible: true}
	if prober, ok := adapter.(runtime.Prober); ok {
		info = prober.Probe(ctx)
	}
	view := runtimeView{
		Name:         name,
		Available:    info.Version != "" || name == "mock",
		Installed:    info.Version != "" || name == "mock",
		Supported:    true,
		Compatible:   info.Compatible,
		Version:      info.Version,
		Detail:       info.Detail,
		Capabilities: info.Capabilities,
		Models:       []runtimeModelView{},
		ModelsError:  info.ModelsError,
	}
	for _, model := range info.Models {
		source := model.Source
		if source == "" {
			source = runtime.ModelSourceRuntime
		}
		status := model.Status
		if status == "" {
			status = runtime.ModelStatusAvailable
		}
		view.Models = append(view.Models, runtimeModelView{
			ID:         model.ID,
			Label:      model.Label,
			Source:     source,
			Default:    model.Default,
			Status:     status,
			Deprecated: model.Deprecated,
		})
	}
	return view, true
}

// runtimeView builds the merged model catalog for one runtime. Runtime probe
// entries win over local settings entries with the same ID (PRD §5.17).
func (a *API) runtimeView(ctx context.Context, name string) (runtimeView, bool) {
	view, ok := a.runtimeProbeView(ctx, name)
	if !ok {
		return runtimeView{}, false
	}

	config, err := a.store.GetRuntimeModelConfig(ctx, name)
	if err != nil && err != store.ErrNotFound {
		if view.ModelsError == "" {
			view.ModelsError = "failed to load local model configuration"
		}
	}
	if err == nil {
		view.DefaultModel = config.DefaultModel
		for _, model := range config.Models {
			if model.ID == "" || containsModel(view.Models, model.ID) {
				continue
			}
			view.Models = append(view.Models, runtimeModelView{
				ID:     model.ID,
				Label:  model.Label,
				Source: runtime.ModelSourceSettings,
				Status: runtime.ModelStatusUnverified,
			})
		}
	}
	return view, true
}

func (a *API) runtimeViews(ctx context.Context) []runtimeView {
	views := make([]runtimeView, 0, len(a.registry.Names()))
	seen := map[string]bool{}
	for _, name := range a.registry.Names() {
		if view, ok := a.runtimeView(ctx, name); ok {
			views = append(views, view)
			seen[name] = true
		}
	}
	// Installed harness CLIs without an execution adapter are still shown,
	// with supported=false, so the runtime dropdown reflects the machine
	// (PRD runtime-and-workspace §6.4.1).
	for _, harness := range runtime.DetectInstalled(ctx) {
		if seen[harness.Name] {
			continue
		}
		view := runtimeView{
			Name:        harness.Name,
			Available:   true,
			Installed:   true,
			Supported:   false,
			Compatible:  harness.Version != "",
			Version:     harness.Version,
			Models:      []runtimeModelView{},
			ModelsError: harness.ModelsError,
		}
		if view.ModelsError == "" {
			view.ModelsError = "execution adapter is not implemented yet"
		}
		for _, model := range harness.Models {
			view.Models = append(view.Models, runtimeModelView{
				ID:     model.ID,
				Label:  model.Label,
				Source: runtime.ModelSourceRuntime,
				Status: runtime.ModelStatusAvailable,
			})
		}
		views = append(views, view)
		seen[harness.Name] = true
	}
	return views
}

func (a *API) listRuntimes(w http.ResponseWriter, r *http.Request) {
	a.writeJSON(w, http.StatusOK, map[string]any{"runtimes": a.runtimeViews(r.Context())})
}

type runtimeModelsInput struct {
	Models       []domain.RuntimeModel `json:"models"`
	DefaultModel string                `json:"defaultModel"`
}

type modelTestInput struct {
	Model string `json:"model"`
}

// testRuntimeModel performs one minimal read-only model request. A failed
// connectivity check is a valid test result (HTTP 200, ok=false), not a
// server error; invalid runtimes/models remain 400.
func (a *API) testRuntimeModel(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	adapter, ok := a.registry.Get(name)
	if !ok {
		a.writeAPIError(w, http.StatusBadRequest, "RUNTIME_NOT_SUPPORTED", "runtime is not available for execution", map[string]any{"runtime": name})
		return
	}
	var input modelTestInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	input.Model = strings.TrimSpace(input.Model)
	if details, message := a.validateAgentModel(r.Context(), name, input.Model); message != "" {
		a.writeAPIError(w, http.StatusBadRequest, "MODEL_NOT_AVAILABLE", message, details)
		return
	}
	tester, ok := adapter.(runtime.ModelTester)
	if !ok {
		a.writeAPIError(w, http.StatusBadRequest, "RUNTIME_NOT_SUPPORTED", "runtime does not support model connectivity tests", map[string]any{"runtime": name})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	result, err := tester.TestModel(ctx, input.Model)
	payload := map[string]any{
		"runtime":   name,
		"model":     input.Model,
		"ok":        err == nil,
		"latencyMs": result.Latency.Milliseconds(),
	}
	if err != nil {
		payload["error"] = err.Error()
		var runtimeErr *runtime.Error
		if errors.As(err, &runtimeErr) {
			payload["errorCode"] = runtimeErr.Detail
		}
		a.writeJSON(w, http.StatusOK, payload)
		return
	}
	payload["message"] = result.Reply
	a.writeJSON(w, http.StatusOK, payload)
}

func (a *API) updateRuntimeModels(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := a.registry.Get(name); !ok {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "unknown runtime", map[string]any{
			"runtime":   name,
			"available": a.registry.Names(),
		})
		return
	}
	var input runtimeModelsInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	if len(input.Models) > 100 {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "too many models; maximum is 100", nil)
		return
	}
	models := make([]domain.RuntimeModel, 0, len(input.Models))
	seen := map[string]bool{}
	for _, model := range input.Models {
		id := strings.TrimSpace(model.ID)
		label := strings.TrimSpace(model.Label)
		if id == "" || len(id) > 100 || len(label) > 100 {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "model id is required and id/label must be at most 100 characters", map[string]any{"id": model.ID})
			return
		}
		if seen[id] {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "duplicate model id: "+id, map[string]any{"id": id})
			return
		}
		seen[id] = true
		models = append(models, domain.RuntimeModel{ID: id, Label: label})
	}
	// A default model must resolve against the catalog the runtime will see
	// after this save: probed models plus the submitted local models.
	defaultModel := strings.TrimSpace(input.DefaultModel)
	if defaultModel != "" {
		probeView, _ := a.runtimeProbeView(r.Context(), name)
		available := make(map[string]bool, len(probeView.Models)+len(models))
		for _, model := range probeView.Models {
			available[model.ID] = true
		}
		for _, model := range models {
			available[model.ID] = true
		}
		if !available[defaultModel] {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "default model "+defaultModel+" is not available for runtime "+name, map[string]any{
				"runtime":      name,
				"defaultModel": defaultModel,
			})
			return
		}
	}
	if _, err := a.store.SetRuntimeModelConfig(r.Context(), name, models, defaultModel); err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	view, ok := a.runtimeView(r.Context(), name)
	if !ok {
		a.writeError(w, http.StatusInternalServerError, "runtime disappeared while saving models")
		return
	}
	a.writeJSON(w, http.StatusOK, view)
}

func containsModel(models []runtimeModelView, id string) bool {
	for _, model := range models {
		if model.ID == id {
			return true
		}
	}
	return false
}

// validateAgentModel enforces that a non-empty model is one of the runtime's
// current catalog entries (PRD AGENT-079/080).
func (a *API) validateAgentModel(ctx context.Context, runtimeName, model string) (map[string]any, string) {
	model = strings.TrimSpace(model)
	if model == "" {
		return nil, ""
	}
	view, ok := a.runtimeView(ctx, runtimeName)
	if !ok {
		return nil, ""
	}
	available := make([]string, 0, len(view.Models))
	for _, item := range view.Models {
		available = append(available, item.ID)
		if item.ID == model {
			return nil, ""
		}
	}
	return map[string]any{
		"runtime":         runtimeName,
		"model":           model,
		"availableModels": available,
	}, "model " + model + " is not available for runtime " + runtimeName
}

func (a *API) agentModelStatus(ctx context.Context, agent *domain.Agent) string {
	if strings.TrimSpace(agent.Model) == "" {
		return ""
	}
	view, ok := a.runtimeView(ctx, agent.Runtime)
	return modelStatusFrom(agent.Model, view, ok)
}

func modelStatusFrom(model string, view runtimeView, runtimeFound bool) string {
	if strings.TrimSpace(model) == "" {
		return ""
	}
	if !runtimeFound {
		return "unknown"
	}
	for _, item := range view.Models {
		if item.ID == model {
			if item.Status == runtime.ModelStatusUnavailable {
				return "unavailable"
			}
			return "available"
		}
	}
	if view.ModelsError != "" {
		return "unknown"
	}
	return "unavailable"
}

func (a *API) decorateAgent(ctx context.Context, agent *domain.Agent) {
	agent.ModelStatus = a.agentModelStatus(ctx, agent)
}

func (a *API) decorateAgents(ctx context.Context, agents []domain.Agent) {
	views := map[string]runtimeView{}
	missing := map[string]bool{}
	for index := range agents {
		name := agents[index].Runtime
		view, ok := views[name]
		if !ok && !missing[name] {
			view, ok = a.runtimeView(ctx, name)
			if ok {
				views[name] = view
			} else {
				missing[name] = true
			}
		}
		agents[index].ModelStatus = modelStatusFrom(agents[index].Model, view, ok && !missing[name])
	}
}

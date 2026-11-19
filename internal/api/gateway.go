package api

import (
	"net/http"
	"strings"

	"github.com/lxqddd/ATeam/internal/gateway"
)

func (a *API) requireGateway(w http.ResponseWriter) bool {
	if a.gateway == nil {
		a.writeAPIError(w, http.StatusServiceUnavailable, "GATEWAY_DISABLED", "gateway is not enabled", nil)
		return false
	}
	return true
}

func (a *API) gatewayStatus(w http.ResponseWriter, r *http.Request) {
	if !a.requireGateway(w) {
		return
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	baseURL := a.gateway.BaseURL()
	if baseURL == "" {
		baseURL = scheme + "://" + r.Host + "/gateway"
	}
	providers := a.gateway.ProviderViews()
	a.writeJSON(w, http.StatusOK, map[string]any{
		"baseUrl":    baseURL,
		"token":      a.gateway.Token(),
		"configured": len(providers) > 0,
		"providers":  providers,
	})
}

func (a *API) listGatewayProviders(w http.ResponseWriter, _ *http.Request) {
	if !a.requireGateway(w) {
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"providers": a.gateway.ProviderViews()})
}

type gatewayProviderInput struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
	Default bool   `json:"default"`
}

func (a *API) createGatewayProvider(w http.ResponseWriter, r *http.Request) {
	if !a.requireGateway(w) {
		return
	}
	var input gatewayProviderInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	view, err := a.gateway.Upsert(gateway.ProviderInput{
		Name: input.Name, Kind: input.Kind, BaseURL: input.BaseURL,
		APIKey: input.APIKey, Model: input.Model, Default: input.Default,
	})
	if err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	a.writeJSON(w, http.StatusCreated, view)
}

func (a *API) updateGatewayProvider(w http.ResponseWriter, r *http.Request) {
	if !a.requireGateway(w) {
		return
	}
	var input gatewayProviderInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "provider id is required", nil)
		return
	}
	view, err := a.gateway.Upsert(gateway.ProviderInput{
		ID: id, Name: input.Name, Kind: input.Kind, BaseURL: input.BaseURL,
		APIKey: input.APIKey, Model: input.Model, Default: input.Default,
	})
	if err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}
	a.writeJSON(w, http.StatusOK, view)
}

func (a *API) deleteGatewayProvider(w http.ResponseWriter, r *http.Request) {
	if !a.requireGateway(w) {
		return
	}
	if err := a.gateway.Delete(r.PathValue("id")); err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) rotateGatewayToken(w http.ResponseWriter, _ *http.Request) {
	if !a.requireGateway(w) {
		return
	}
	token, err := a.gateway.RotateToken()
	if err != nil {
		a.writeAPIError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]any{"token": token})
}

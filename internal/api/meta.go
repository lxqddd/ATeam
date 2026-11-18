package api

import (
	"net/http"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/runtime"
)

// getMeta publishes the runtime catalog with cached probe results so the UI
// can show which runtimes are installed and compatible (M1-RUNTIME-001,
// AC-UI-03). Probing never reads credentials and is cached per process.
func (a *API) getMeta(w http.ResponseWriter, r *http.Request) {
	runtimes := make([]map[string]any, 0)
	for _, name := range a.registry.Names() {
		adapter, ok := a.registry.Get(name)
		if !ok {
			continue
		}
		entry := map[string]any{
			"name":       name,
			"installed":  true,
			"compatible": true,
			"version":    "builtin",
		}
		if prober, ok := adapter.(runtime.Prober); ok {
			info := prober.Probe(r.Context())
			entry = map[string]any{
				"name":       name,
				"installed":  info.Version != "",
				"compatible": info.Compatible,
				"version":    info.Version,
				"detail":     info.Detail,
			}
		}
		runtimes = append(runtimes, entry)
	}
	a.writeJSON(w, http.StatusOK, map[string]any{
		"version":  a.version,
		"runtimes": runtimes,
		"artifacts": map[string]any{
			"maxBytes":          artifact.MaxArtifactBytes,
			"textTruncateBytes": artifact.MaxTextEvidenceBytes,
			"previewBytes":      artifact.PreviewBytes,
			"types":             []string{domain.ArtifactDiff, domain.ArtifactTestReport, domain.ArtifactLogBundle, domain.ArtifactNote, domain.ArtifactScreenshot, domain.ArtifactFile},
		},
	})
}

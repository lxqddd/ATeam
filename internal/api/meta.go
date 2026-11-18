package api

import (
	"net/http"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
)

// getMeta publishes the runtime catalog with cached probe results so the UI
// can show which runtimes are installed and compatible (M1-RUNTIME-001,
// AC-UI-03). Probing never reads credentials and is cached per process.
func (a *API) getMeta(w http.ResponseWriter, r *http.Request) {
	a.writeJSON(w, http.StatusOK, map[string]any{
		"version":  a.version,
		"runtimes": a.runtimeViews(r.Context()),
		"artifacts": map[string]any{
			"maxBytes":          artifact.MaxArtifactBytes,
			"textTruncateBytes": artifact.MaxTextEvidenceBytes,
			"previewBytes":      artifact.PreviewBytes,
			"types":             []string{domain.ArtifactDiff, domain.ArtifactTestReport, domain.ArtifactLogBundle, domain.ArtifactNote, domain.ArtifactScreenshot, domain.ArtifactFile},
		},
	})
}

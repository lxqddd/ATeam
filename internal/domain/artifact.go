package domain

import "time"

// Artifact is one piece of run evidence. Metadata lives in SQLite; content is
// stored on disk under the data directory and never accepted from clients as
// an arbitrary path (PRD runtime-and-workspace §10).
type Artifact struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspaceId"`
	TaskID         string    `json:"taskId"`
	RunID          string    `json:"runId"`
	Type           string    `json:"type"`
	Subtype        string    `json:"subtype,omitempty"`
	Name           string    `json:"name"`
	MediaType      string    `json:"mediaType"`
	SizeBytes      int64     `json:"sizeBytes"`
	SHA256         string    `json:"sha256"`
	StoragePath    string    `json:"-"`
	Origin         string    `json:"origin"`
	Truncated      bool      `json:"truncated"`
	SupersedesID   string    `json:"supersedesId,omitempty"`
	RedactionState string    `json:"redactionState"`
	CreatedAt      time.Time `json:"createdAt"`
}

const (
	ArtifactDiff       = "diff"
	ArtifactTestReport = "test_report"
	ArtifactLogBundle  = "log_bundle"
	ArtifactNote       = "note"
	ArtifactScreenshot = "screenshot"
	ArtifactFile       = "file"
)

const (
	ArtifactOriginSystemCollected    = "system_collected"
	ArtifactOriginSystemVerification = "system_verification"
	ArtifactOriginAgent              = "agent"
)

const (
	RedactionNone     = "none"
	RedactionRedacted = "redacted"
)

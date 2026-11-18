// Package artifact stores run evidence: it redacts secrets, enforces size
// limits, dedupes identical content by sha256, writes files under the data
// directory and records metadata (PRD runtime-and-workspace §10, M1-ART-*).
package artifact

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
)

const (
	// MaxArtifactBytes is the per-artifact hard limit (M1-ART-004).
	MaxArtifactBytes = 50 * 1024 * 1024
	// MaxTextEvidenceBytes truncates individual text evidence; the caller
	// keeps the full content in a log_bundle.
	MaxTextEvidenceBytes = 10 * 1024 * 1024
	// PreviewBytes is the default text preview cap for downloads.
	PreviewBytes = 1 * 1024 * 1024
)

var ErrTooLarge = errors.New("artifact exceeds the 50 MiB limit")

type Writer struct {
	store store.Store
	root  string
}

func NewWriter(st store.Store, dataDir string) *Writer {
	return &Writer{store: st, root: filepath.Join(dataDir, "artifacts")}
}

type Input struct {
	WorkspaceID  string
	TaskID       string
	RunID        string
	Type         string
	Subtype      string
	Name         string
	MediaType    string
	Origin       string
	SupersedesID string
	Data         []byte
}

// Save stores one artifact. Text evidence is redacted before hashing and
// writing; identical content reuses an existing storage file while keeping
// its own metadata reference (cross-run dedupe).
func (w *Writer) Save(ctx context.Context, input Input) (*domain.Artifact, error) {
	if len(input.Data) > MaxArtifactBytes {
		return nil, ErrTooLarge
	}

	data := input.Data
	redactionState := domain.RedactionNone
	truncated := false
	if isTextEvidence(input) {
		data, redactionState = Redact(data)
		if input.Type != domain.ArtifactLogBundle && len(data) > MaxTextEvidenceBytes {
			data = data[:MaxTextEvidenceBytes]
			truncated = true
		}
	}

	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])

	id := domain.NewID()
	storagePath := ""
	if existing, err := w.store.FindArtifactBySHA(ctx, digest); err == nil && existing.StoragePath != "" {
		storagePath = existing.StoragePath
	} else {
		dir := filepath.Join(w.root, sanitizeSegment(input.RunID))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create artifact directory: %w", err)
		}
		storagePath = filepath.Join(dir, id+"-"+sanitizeSegment(input.Name))
		if err := os.WriteFile(storagePath, data, 0o644); err != nil {
			return nil, fmt.Errorf("write artifact content: %w", err)
		}
	}

	artifactRecord := &domain.Artifact{
		ID:             id,
		WorkspaceID:    input.WorkspaceID,
		TaskID:         input.TaskID,
		RunID:          input.RunID,
		Type:           input.Type,
		Subtype:        input.Subtype,
		Name:           input.Name,
		MediaType:      input.MediaType,
		SizeBytes:      int64(len(data)),
		SHA256:         digest,
		StoragePath:    storagePath,
		Origin:         input.Origin,
		Truncated:      truncated,
		SupersedesID:   input.SupersedesID,
		RedactionState: redactionState,
	}
	if err := w.store.CreateArtifact(ctx, artifactRecord); err != nil {
		return nil, err
	}
	return artifactRecord, nil
}

// Read returns at most maxBytes of an artifact's content. It reports whether
// the content was truncated for the preview.
func Read(artifactRecord *domain.Artifact, maxBytes int64) ([]byte, bool, error) {
	if artifactRecord.StoragePath == "" {
		return nil, false, store.ErrNotFound
	}
	file, err := os.Open(artifactRecord.StoragePath)
	if err != nil {
		return nil, false, fmt.Errorf("open artifact content: %w", err)
	}
	defer file.Close()

	if maxBytes <= 0 || maxBytes > artifactRecord.SizeBytes {
		maxBytes = artifactRecord.SizeBytes
	}
	data := make([]byte, maxBytes)
	read, err := file.Read(data)
	if err != nil && read == 0 {
		return nil, false, fmt.Errorf("read artifact content: %w", err)
	}
	truncated := int64(read) < artifactRecord.SizeBytes
	return data[:read], truncated, nil
}

func isTextEvidence(input Input) bool {
	switch input.Type {
	case domain.ArtifactDiff, domain.ArtifactTestReport, domain.ArtifactLogBundle, domain.ArtifactNote:
		return true
	}
	return strings.HasPrefix(input.MediaType, "text/")
}

func sanitizeSegment(value string) string {
	var builder strings.Builder
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9', char == '.', char == '_', char == '-':
			builder.WriteRune(char)
		default:
			builder.WriteRune('_')
		}
	}
	result := strings.Trim(builder.String(), "._-")
	if result == "" {
		return "artifact"
	}
	return result
}

package artifact

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
)

func newTestWriter(t *testing.T) (*Writer, store.Store, string) {
	t.Helper()
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	dataDir := t.TempDir()
	return NewWriter(st, dataDir), st, dataDir
}

func TestWriterRedactsSecrets(t *testing.T) {
	writer, _, _ := newTestWriter(t)
	content := strings.Join([]string{
		"key sk-abcdefghijklmnopqrstuvwxyz",
		"Authorization: Bearer abcdefghijklmnop",
		"postgres://user:supersecret@db.local/app",
		"-----BEGIN RSA PRIVATE KEY-----",
		"secretmaterial",
		"-----END RSA PRIVATE KEY-----",
	}, "\n")

	saved, err := writer.Save(context.Background(), Input{
		RunID:     "run-1",
		TaskID:    "task-1",
		Type:      domain.ArtifactDiff,
		Name:      "run.diff",
		MediaType: "text/plain",
		Origin:    domain.ArtifactOriginSystemCollected,
		Data:      []byte(content),
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.RedactionState != domain.RedactionRedacted {
		t.Fatalf("redaction state = %q", saved.RedactionState)
	}
	stored, err := os.ReadFile(saved.StoragePath)
	if err != nil {
		t.Fatalf("read stored: %v", err)
	}
	for _, secret := range []string{"sk-abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnop", "supersecret", "secretmaterial"} {
		if strings.Contains(string(stored), secret) {
			t.Fatalf("secret %q leaked: %s", secret, stored)
		}
	}
	for _, placeholder := range []string{"[REDACTED:api_key]", "[REDACTED:bearer_token]", "[REDACTED:db_password]", "[REDACTED:private_key]"} {
		if !strings.Contains(string(stored), placeholder) {
			t.Fatalf("missing placeholder %q: %s", placeholder, stored)
		}
	}
}

func TestWriterTruncatesTextEvidenceButKeepsLogBundleFull(t *testing.T) {
	writer, _, _ := newTestWriter(t)
	large := []byte(strings.Repeat("x", MaxTextEvidenceBytes+10))

	diff, err := writer.Save(context.Background(), Input{
		RunID: "run-1", Type: domain.ArtifactDiff, Name: "run.diff", MediaType: "text/plain",
		Data: large,
	})
	if err != nil {
		t.Fatalf("save diff: %v", err)
	}
	if !diff.Truncated || diff.SizeBytes != MaxTextEvidenceBytes {
		t.Fatalf("diff truncation: %+v", diff)
	}

	bundle, err := writer.Save(context.Background(), Input{
		RunID: "run-1", Type: domain.ArtifactLogBundle, Subtype: "diff_full", Name: "diff.full.txt", MediaType: "text/plain",
		Data: large,
	})
	if err != nil {
		t.Fatalf("save bundle: %v", err)
	}
	if bundle.Truncated {
		t.Fatal("log bundles hold the full content and must not truncate below 50 MiB")
	}
}

func TestWriterRejectsOversizedArtifact(t *testing.T) {
	writer, _, _ := newTestWriter(t)
	oversized := make([]byte, MaxArtifactBytes+1)
	if _, err := writer.Save(context.Background(), Input{
		RunID: "run-1", Type: domain.ArtifactFile, Name: "big.bin", MediaType: "application/octet-stream", Data: oversized,
	}); err != ErrTooLarge {
		t.Fatalf("error = %v, want ErrTooLarge", err)
	}
}

func TestWriterDedupesIdenticalContent(t *testing.T) {
	writer, st, _ := newTestWriter(t)
	payload := []byte("same content")
	first, err := writer.Save(context.Background(), Input{RunID: "run-1", Type: domain.ArtifactNote, Name: "a.txt", MediaType: "text/plain", Data: payload})
	if err != nil {
		t.Fatalf("save first: %v", err)
	}
	second, err := writer.Save(context.Background(), Input{RunID: "run-2", Type: domain.ArtifactNote, Name: "b.txt", MediaType: "text/plain", Data: payload})
	if err != nil {
		t.Fatalf("save second: %v", err)
	}
	if first.ID == second.ID {
		t.Fatal("each reference keeps its own artifact record")
	}
	if first.StoragePath != second.StoragePath {
		t.Fatalf("identical content should share storage: %q vs %q", first.StoragePath, second.StoragePath)
	}
	if _, err := st.GetArtifact(context.Background(), second.ID); err != nil {
		t.Fatalf("second artifact row missing: %v", err)
	}
}

func TestReadLimitsPreview(t *testing.T) {
	writer, _, _ := newTestWriter(t)
	saved, err := writer.Save(context.Background(), Input{RunID: "run-1", Type: domain.ArtifactNote, Name: "n.txt", MediaType: "text/plain", Data: []byte("0123456789")})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	data, truncated, err := Read(saved, 4)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(data) != "0123" || !truncated {
		t.Fatalf("read = %q truncated=%v", data, truncated)
	}
}

func TestVerificationCommandsRunWithExitCodes(t *testing.T) {
	results := RunVerificationCommands(context.Background(), t.TempDir(), []string{"true", "false"})
	if len(results) != 2 {
		t.Fatalf("results = %d", len(results))
	}
	if results[0].ExitCode != 0 {
		t.Fatalf("true exit = %d", results[0].ExitCode)
	}
	if results[1].ExitCode == 0 {
		t.Fatalf("false exit = %d, want non-zero", results[1].ExitCode)
	}
	if !strings.Contains(results[1].Render(), "exitCode:") {
		t.Fatal("rendered report missing exit code")
	}
}

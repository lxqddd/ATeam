package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/lxqddd/ATeam/internal/domain"
)

const reviewColumns = `id, workspace_id, task_id, run_id, status, requested_by, reviewer_id, decision_note, evidence_snapshot_hash, requires_merge, no_merge_reason, created_at, started_at, decided_at, superseded_by, revision`

func (s *SQLite) CreateReview(ctx context.Context, review *domain.Review) error {
	if review.ID == "" {
		review.ID = domain.NewID()
	}
	if review.Status == "" {
		review.Status = domain.ReviewPending
	}
	if review.Revision == 0 {
		review.Revision = 1
	}
	if review.CreatedAt.IsZero() {
		review.CreatedAt = domain.Now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO reviews (`+reviewColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		review.ID,
		review.WorkspaceID,
		review.TaskID,
		review.RunID,
		review.Status,
		review.RequestedBy,
		review.ReviewerID,
		review.DecisionNote,
		review.EvidenceSnapshotHash,
		boolInt(review.RequiresMerge),
		review.NoMergeReason,
		millis(review.CreatedAt),
		millisPtr(review.StartedAt),
		millisPtr(review.DecidedAt),
		review.SupersededBy,
		review.Revision,
	)
	if err != nil {
		return fmt.Errorf("create review: %w", err)
	}
	return nil
}

func (s *SQLite) GetReview(ctx context.Context, id string) (*domain.Review, error) {
	review, err := scanReview(s.db.QueryRowContext(ctx, `SELECT `+reviewColumns+` FROM reviews WHERE id = ?`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("review %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("get review: %w", err)
	}
	return review, nil
}

func (s *SQLite) ListReviewsByRun(ctx context.Context, runID string) ([]domain.Review, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+reviewColumns+` FROM reviews WHERE run_id = ? ORDER BY created_at DESC`, runID)
	if err != nil {
		return nil, fmt.Errorf("list reviews: %w", err)
	}
	defer rows.Close()

	reviews := []domain.Review{}
	for rows.Next() {
		review, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		reviews = append(reviews, *review)
	}
	return reviews, rows.Err()
}

// UpdateReviewIfStatus updates a review only while its stored status matches,
// keeping decisions immutable under concurrency.
func (s *SQLite) UpdateReviewIfStatus(ctx context.Context, review *domain.Review, expectedStatus string) (bool, error) {
	review.Revision++
	result, err := s.db.ExecContext(ctx, `UPDATE reviews SET status = ?, reviewer_id = ?, decision_note = ?, evidence_snapshot_hash = ?, started_at = ?, decided_at = ?, superseded_by = ?, revision = ? WHERE id = ? AND status = ?`,
		review.Status,
		review.ReviewerID,
		review.DecisionNote,
		review.EvidenceSnapshotHash,
		millisPtr(review.StartedAt),
		millisPtr(review.DecidedAt),
		review.SupersededBy,
		review.Revision,
		review.ID,
		expectedStatus,
	)
	if err != nil {
		return false, fmt.Errorf("update review: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("update review: rows affected: %w", err)
	}
	if affected == 0 {
		review.Revision--
	}
	return affected > 0, nil
}

func (s *SQLite) CreateReviewComment(ctx context.Context, comment *domain.ReviewComment) error {
	if comment.ID == "" {
		comment.ID = domain.NewID()
	}
	if comment.Severity == "" {
		comment.Severity = "info"
	}
	if comment.CreatedAt.IsZero() {
		comment.CreatedAt = domain.Now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO review_comments (id, review_id, artifact_id, file_path, line, severity, body, resolved_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		comment.ID,
		comment.ReviewID,
		comment.ArtifactID,
		comment.FilePath,
		nullableInt(comment.Line),
		comment.Severity,
		comment.Body,
		comment.CreatedBy,
		millis(comment.CreatedAt),
	)
	if err != nil {
		return fmt.Errorf("create review comment: %w", err)
	}
	return nil
}

func (s *SQLite) ListReviewComments(ctx context.Context, reviewID string) ([]domain.ReviewComment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, review_id, artifact_id, file_path, line, severity, body, resolved_at, created_by, created_at FROM review_comments WHERE review_id = ? ORDER BY created_at`, reviewID)
	if err != nil {
		return nil, fmt.Errorf("list review comments: %w", err)
	}
	defer rows.Close()

	comments := []domain.ReviewComment{}
	for rows.Next() {
		var (
			comment    domain.ReviewComment
			line       sql.NullInt64
			resolvedAt sql.NullInt64
			created    int64
		)
		if err := rows.Scan(&comment.ID, &comment.ReviewID, &comment.ArtifactID, &comment.FilePath, &line, &comment.Severity, &comment.Body, &resolvedAt, &comment.CreatedBy, &created); err != nil {
			return nil, fmt.Errorf("scan review comment: %w", err)
		}
		if line.Valid {
			value := int(line.Int64)
			comment.Line = &value
		}
		if resolvedAt.Valid {
			comment.ResolvedAt = timePtrFromMillis(resolvedAt.Int64)
		}
		comment.CreatedAt = timeFromMillis(created)
		comments = append(comments, comment)
	}
	return comments, rows.Err()
}

func (s *SQLite) ResolveReviewComment(ctx context.Context, id string) (*domain.ReviewComment, error) {
	result, err := s.db.ExecContext(ctx, `UPDATE review_comments SET resolved_at = ? WHERE id = ? AND resolved_at = 0`, millis(domain.Now()), id)
	if err != nil {
		return nil, fmt.Errorf("resolve review comment: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("resolve review comment: rows affected: %w", err)
	}
	if affected == 0 {
		return nil, fmt.Errorf("review comment %s: %w", id, ErrNotFound)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, review_id, artifact_id, file_path, line, severity, body, resolved_at, created_by, created_at FROM review_comments WHERE id = ?`, id)
	if err != nil {
		return nil, fmt.Errorf("load resolved comment: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, fmt.Errorf("review comment %s: %w", id, ErrNotFound)
	}
	var (
		comment    domain.ReviewComment
		line       sql.NullInt64
		resolvedAt sql.NullInt64
		created    int64
	)
	if err := rows.Scan(&comment.ID, &comment.ReviewID, &comment.ArtifactID, &comment.FilePath, &line, &comment.Severity, &comment.Body, &resolvedAt, &comment.CreatedBy, &created); err != nil {
		return nil, fmt.Errorf("scan resolved comment: %w", err)
	}
	if line.Valid {
		value := int(line.Int64)
		comment.Line = &value
	}
	if resolvedAt.Valid {
		comment.ResolvedAt = timePtrFromMillis(resolvedAt.Int64)
	}
	comment.CreatedAt = timeFromMillis(created)
	return &comment, nil
}

func (s *SQLite) CreateMergeRecord(ctx context.Context, record *domain.MergeRecord) error {
	if record.ID == "" {
		record.ID = domain.NewID()
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = domain.Now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO merge_records (id, workspace_id, run_id, review_id, approval_id, target_branch, source_branch, strategy, "commit", operator, result, created_at) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
		record.ID,
		record.WorkspaceID,
		record.RunID,
		record.ReviewID,
		record.TargetBranch,
		record.SourceBranch,
		record.Strategy,
		record.Commit,
		record.Operator,
		record.Result,
		millis(record.CreatedAt),
	)
	if err != nil {
		return fmt.Errorf("create merge record: %w", err)
	}
	return nil
}

// GetMergeRecordByRun reports whether the run was already merged.
func (s *SQLite) GetMergeRecordByRun(ctx context.Context, runID string) (*domain.MergeRecord, error) {
	var (
		record  domain.MergeRecord
		created int64
	)
	err := s.db.QueryRowContext(ctx, `SELECT id, workspace_id, run_id, review_id, target_branch, source_branch, strategy, "commit", operator, result, created_at FROM merge_records WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`, runID).
		Scan(&record.ID, &record.WorkspaceID, &record.RunID, &record.ReviewID, &record.TargetBranch, &record.SourceBranch, &record.Strategy, &record.Commit, &record.Operator, &record.Result, &created)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("merge record for %s: %w", runID, ErrNotFound)
		}
		return nil, fmt.Errorf("get merge record: %w", err)
	}
	record.CreatedAt = timeFromMillis(created)
	return &record, nil
}

func scanReview(scanner interface{ Scan(...any) error }) (*domain.Review, error) {
	var (
		review        domain.Review
		requiresMerge int
		created       int64
		started       int64
		decided       int64
	)
	if err := scanner.Scan(
		&review.ID,
		&review.WorkspaceID,
		&review.TaskID,
		&review.RunID,
		&review.Status,
		&review.RequestedBy,
		&review.ReviewerID,
		&review.DecisionNote,
		&review.EvidenceSnapshotHash,
		&requiresMerge,
		&review.NoMergeReason,
		&created,
		&started,
		&decided,
		&review.SupersededBy,
		&review.Revision,
	); err != nil {
		return nil, err
	}
	review.RequiresMerge = requiresMerge != 0
	review.CreatedAt = timeFromMillis(created)
	review.StartedAt = timePtrFromMillis(started)
	review.DecidedAt = timePtrFromMillis(decided)
	return &review, nil
}

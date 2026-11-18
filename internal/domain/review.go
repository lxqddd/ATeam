package domain

import "time"

const (
	ReviewPending          = "pending"
	ReviewInReview         = "in_review"
	ReviewApproved         = "approved"
	ReviewChangesRequested = "changes_requested"
	ReviewSuperseded       = "superseded"
	ReviewCancelled        = "cancelled"
)

// Review is one human decision on a run's evidence. Decisions are immutable;
// changing a conclusion creates a new review that supersedes the old one.
type Review struct {
	ID                   string     `json:"id"`
	WorkspaceID          string     `json:"workspaceId"`
	TaskID               string     `json:"taskId"`
	RunID                string     `json:"runId"`
	Status               string     `json:"status"`
	RequestedBy          string     `json:"requestedBy"`
	ReviewerID           string     `json:"reviewerId"`
	DecisionNote         string     `json:"decisionNote"`
	EvidenceSnapshotHash string     `json:"evidenceSnapshotHash"`
	RequiresMerge        bool       `json:"requiresMerge"`
	NoMergeReason        string     `json:"noMergeReason,omitempty"`
	CreatedAt            time.Time  `json:"createdAt"`
	StartedAt            *time.Time `json:"startedAt,omitempty"`
	DecidedAt            *time.Time `json:"decidedAt,omitempty"`
	SupersededBy         string     `json:"supersededBy,omitempty"`
	Revision             int        `json:"revision"`
}

// ReviewComment is a line comment (or a general note) attached to a review.
type ReviewComment struct {
	ID         string     `json:"id"`
	ReviewID   string     `json:"reviewId"`
	ArtifactID string     `json:"artifactId,omitempty"`
	FilePath   string     `json:"filePath,omitempty"`
	Line       *int       `json:"line,omitempty"`
	Severity   string     `json:"severity"`
	Body       string     `json:"body"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
	CreatedBy  string     `json:"createdBy"`
	CreatedAt  time.Time  `json:"createdAt"`
}

// MergeRecord is the audit trail of one successful local merge.
type MergeRecord struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	RunID        string    `json:"runId"`
	ReviewID     string    `json:"reviewId"`
	TargetBranch string    `json:"targetBranch"`
	SourceBranch string    `json:"sourceBranch"`
	Strategy     string    `json:"strategy"`
	Commit       string    `json:"commit"`
	Operator     string    `json:"operator"`
	Result       string    `json:"result"`
	CreatedAt    time.Time `json:"createdAt"`
}

// LocalOperator identifies the sole reviewer/operator in M1 local mode.
const LocalOperator = "local"

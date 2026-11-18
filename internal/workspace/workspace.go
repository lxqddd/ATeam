package workspace

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Manager owns the plain run directories and the git worktrees used by code
// changing runs. Git operations for the same repository are serialized with
// an in-process mutex plus a lock file so a second ATeam process cannot race
// the same repository (PRD runtime-and-workspace §8.3).
type Manager struct {
	dataDir string
	mu      sync.Mutex
	repoMu  map[string]*sync.Mutex
}

func New(dataDir string) *Manager {
	return &Manager{
		dataDir: dataDir,
		repoMu:  make(map[string]*sync.Mutex),
	}
}

// Prepare creates the plain per-run directory used by mock or explicitly
// non-code runs, which do not get a worktree.
func (m *Manager) Prepare(ctx context.Context, runID string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	dir := filepath.Join(m.dataDir, "workspaces", "runs", runID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("prepare workspace: %w", err)
	}
	return dir, nil
}

// DefaultBranchTemplate follows PRD runtime-and-workspace §8.4.
const DefaultBranchTemplate = "ateam/{taskShort}/{slug}-{runShort}"

// WorktreeOptions describes one code changing run's worktree.
type WorktreeOptions struct {
	RepoPath       string
	DefaultBranch  string
	Remote         string
	WorktreeRoot   string
	BranchTemplate string
	TaskID         string
	TaskTitle      string
	RunID          string
}

// Worktree is the provisioned isolation result recorded on the Run.
type Worktree struct {
	Path       string
	Branch     string
	BaseCommit string
}

// CreateWorktree resolves the base commit, names a unique branch, and creates
// the worktree at {worktreeRoot}/{repoSlug}/{runId}. The base branch is
// fetched first when the configured remote exists; a fetch failure blocks
// provisioning (network error, retryable).
func (m *Manager) CreateWorktree(ctx context.Context, opts WorktreeOptions) (Worktree, error) {
	if opts.RepoPath == "" {
		return Worktree{}, fmt.Errorf("workspace is not bound to a repository")
	}
	if opts.DefaultBranch == "" {
		opts.DefaultBranch = "main"
	}
	slug := repoSlug(opts.RepoPath)
	unlock, err := m.lockRepo(ctx, slug)
	if err != nil {
		return Worktree{}, err
	}
	defer unlock()

	if opts.Remote != "" {
		if _, err := gitOutput(ctx, opts.RepoPath, "remote", "get-url", opts.Remote); err == nil {
			if _, err := gitOutput(ctx, opts.RepoPath, "fetch", "--prune", opts.Remote, opts.DefaultBranch); err != nil {
				return Worktree{}, fmt.Errorf("fetch %s/%s failed", opts.Remote, opts.DefaultBranch)
			}
		}
	}

	baseCommit, err := gitOutput(ctx, opts.RepoPath, "rev-parse", "--verify", "refs/heads/"+opts.DefaultBranch+"^{commit}")
	if err != nil || baseCommit == "" {
		return Worktree{}, fmt.Errorf("default branch %q is not available locally", opts.DefaultBranch)
	}

	root := opts.WorktreeRoot
	if root == "" {
		root = filepath.Join(m.dataDir, "worktrees")
	}
	worktreePath := filepath.Join(root, slug, opts.RunID)
	if _, err := os.Stat(worktreePath); err == nil {
		return Worktree{}, fmt.Errorf("a worktree already exists for run %s", opts.RunID)
	}
	if err := os.MkdirAll(filepath.Dir(worktreePath), 0o755); err != nil {
		return Worktree{}, fmt.Errorf("create worktree parent: %w", err)
	}

	branch := branchName(opts)
	for suffix := 2; branchExists(ctx, opts.RepoPath, branch); suffix++ {
		if suffix > 10 {
			return Worktree{}, fmt.Errorf("could not find a unique branch name for this run")
		}
		branch = fmt.Sprintf("%s-%d", branchName(opts), suffix)
	}
	if _, err := gitOutput(ctx, opts.RepoPath, "worktree", "add", "-b", branch, worktreePath, baseCommit); err != nil {
		return Worktree{}, fmt.Errorf("create worktree: %w", err)
	}
	return Worktree{Path: worktreePath, Branch: branch, BaseCommit: baseCommit}, nil
}

// HeadCommit returns the current HEAD of the worktree.
func (m *Manager) HeadCommit(ctx context.Context, worktreePath string) (string, error) {
	return gitOutput(ctx, worktreePath, "rev-parse", "HEAD")
}

// RemoveWorktree deletes a worktree and its branch. Unmerged changes are only
// discarded when force is true; callers must obtain explicit confirmation
// first (PRD: 未合并改动不得自动删除).
func (m *Manager) RemoveWorktree(ctx context.Context, repoPath, worktreePath, branch string, force bool) error {
	if repoPath == "" || worktreePath == "" {
		return fmt.Errorf("repoPath and worktreePath are required")
	}
	slug := repoSlug(repoPath)
	unlock, err := m.lockRepo(ctx, slug)
	if err != nil {
		return err
	}
	defer unlock()

	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, worktreePath)
	if _, err := gitOutput(ctx, repoPath, args...); err != nil {
		return fmt.Errorf("remove worktree: %w", err)
	}
	if branch != "" {
		deleteFlag := "-d"
		if force {
			deleteFlag = "-D"
		}
		if _, err := gitOutput(ctx, repoPath, "branch", deleteFlag, branch); err != nil && force {
			return fmt.Errorf("delete branch %s: %w", branch, err)
		}
	}
	_, _ = gitOutput(ctx, repoPath, "worktree", "prune")
	return nil
}

func (m *Manager) mutexFor(slug string) *sync.Mutex {
	m.mu.Lock()
	defer m.mu.Unlock()
	mutex, ok := m.repoMu[slug]
	if !ok {
		mutex = &sync.Mutex{}
		m.repoMu[slug] = mutex
	}
	return mutex
}

// lockRepo serializes git mutations for one repository across goroutines and
// processes. The lock file lives under {dataDir}/locks; a lock older than ten
// minutes is treated as stale and taken over.
func (m *Manager) lockRepo(ctx context.Context, slug string) (func(), error) {
	mutex := m.mutexFor(slug)
	mutex.Lock()

	lockDir := filepath.Join(m.dataDir, "locks")
	if err := os.MkdirAll(lockDir, 0o755); err != nil {
		mutex.Unlock()
		return nil, fmt.Errorf("create lock directory: %w", err)
	}
	lockPath := filepath.Join(lockDir, slug+".lock")
	deadline := time.Now().Add(30 * time.Second)
	for {
		file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_, _ = fmt.Fprintf(file, "%d %d", os.Getpid(), time.Now().UnixMilli())
			_ = file.Close()
			return func() {
				mutex.Unlock()
				_ = os.Remove(lockPath)
			}, nil
		}
		if !os.IsExist(err) {
			mutex.Unlock()
			return nil, fmt.Errorf("acquire repository lock: %w", err)
		}
		if info, statErr := os.Stat(lockPath); statErr == nil && time.Since(info.ModTime()) > 10*time.Minute {
			_ = os.Remove(lockPath)
			continue
		}
		if time.Now().After(deadline) {
			mutex.Unlock()
			return nil, fmt.Errorf("timed out waiting for the repository lock")
		}
		select {
		case <-ctx.Done():
			mutex.Unlock()
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func branchExists(ctx context.Context, repoPath, branch string) bool {
	_, err := gitOutput(ctx, repoPath, "show-ref", "--verify", "--quiet", "refs/heads/"+branch)
	return err == nil
}

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(value string) string {
	slug := slugPattern.ReplaceAllString(strings.ToLower(value), "-")
	slug = strings.Trim(slug, "-")
	if len(slug) > 32 {
		slug = strings.Trim(slug[:32], "-")
	}
	return slug
}

// branchName builds the run branch: ateam/{taskShort}/{slug}-{runShort},
// degrading to ateam/{taskShort}/{runShort} when the title yields no slug.
func branchName(opts WorktreeOptions) string {
	taskShort := truncateID(opts.TaskID, 8)
	runShort := truncateID(opts.RunID, 6)
	slug := slugify(opts.TaskTitle)
	template := opts.BranchTemplate
	if template == "" {
		template = DefaultBranchTemplate
	}
	if slug == "" {
		template = strings.ReplaceAll(template, "{slug}-", "")
		template = strings.ReplaceAll(template, "-{slug}", "")
		template = strings.ReplaceAll(template, "{slug}", "")
	}
	name := strings.NewReplacer(
		"{taskShort}", taskShort,
		"{slug}", slug,
		"{runShort}", runShort,
	).Replace(template)
	name = strings.ReplaceAll(name, "//", "/")
	return strings.Trim(name, "/-")
}

func truncateID(id string, length int) string {
	if len(id) <= length {
		return id
	}
	return id[:length]
}

// repoSlug gives each repository a stable, filesystem-safe directory name.
func repoSlug(repoPath string) string {
	base := slugify(filepath.Base(filepath.Clean(repoPath)))
	if base == "" {
		base = "repo"
	}
	sum := sha1.Sum([]byte(repoPath))
	return base + "-" + hex.EncodeToString(sum[:4])
}

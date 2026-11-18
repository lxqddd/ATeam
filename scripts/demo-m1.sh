#!/usr/bin/env bash
# M1 local-loop demo.
#
# Starts an isolated ATeam server (temporary HOME and database), binds a
# throwaway git repository as the default workspace, and drives one mock run
# through evidence collection and the completion-definition check.
#
# The mock runtime deliberately does not produce diff/test_report evidence, so
# DoD stays unsatisfied. The full loop (worktree, stream-json events, diff,
# system verification, review, merge) needs an agent whose runtime is `claude`
# with the Claude Code CLI installed and logged in; then approve the run in its
# detail page and merge from the same page.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /tmp/ateam-demo.XXXXXX)"
# Keep Go's caches from the real environment; only ATeam's data dir follows
# the temporary HOME.
ORIG_GOPATH="$(go env GOPATH)"
ORIG_GOMODCACHE="$(go env GOMODCACHE)"
ORIG_GOCACHE="$(go env GOCACHE)"
export HOME="$WORK/home"
export GOPATH="$ORIG_GOPATH" GOMODCACHE="$ORIG_GOMODCACHE" GOCACHE="$ORIG_GOCACHE"
mkdir -p "$HOME"
DATA="$HOME/.ateam"
ADDR="127.0.0.1:8799"
BASE="http://$ADDR/api/v1"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

json() {
  python3 -c "import json,sys; data=json.load(sys.stdin); print(eval(sys.argv[1], {'d': data}))" "$1"
}

echo "==> preparing demo repository"
REPO="$WORK/demo-repo"
mkdir -p "$REPO"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email demo@example.com
git -C "$REPO" config user.name "ATeam Demo"
echo "# demo repo" > "$REPO/README.md"
git -C "$REPO" add .
git -C "$REPO" commit -qm "init"

echo "==> building the server binary"
( cd "$ROOT" && go build -o "$WORK/ateam" ./cmd/ateam )

echo "==> starting ATeam on $ADDR (data: $DATA)"
"$WORK/ateam" serve --addr "$ADDR" --db "$DATA/ateam.db" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 120); do
  curl -sf "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "==> binding workspace to the demo repository"
curl -sf -X POST "$BASE/workspaces" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Demo\",\"repoPath\":\"$REPO\",\"defaultBranch\":\"main\"}" >/dev/null
curl -sf "$BASE/workspaces" | json "d[0]['repoPath']"

echo "==> creating task and mock agent"
TASK_ID="$(curl -sf -X POST "$BASE/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Demo task","status":"todo"}' | json "d['id']")"
AGENT_ID="$(curl -sf -X POST "$BASE/agents" -H 'Content-Type: application/json' \
  -d '{"name":"Demo mock","runtime":"mock"}' | json "d['id']")"

echo "==> running the task"
RUN_ID="$(curl -sf -X POST "$BASE/tasks/$TASK_ID/runs" -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"$AGENT_ID\"}" | json "d['id']")"
for _ in $(seq 1 40); do
  STATUS="$(curl -sf "$BASE/runs/$RUN_ID" | json "d['status']")"
  [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
  sleep 0.5
done

echo "==> run status"
curl -sf "$BASE/runs/$RUN_ID" | json "{k: d.get(k) for k in ('status','workspaceId','attempt','headCommit')}"

echo "==> artifacts"
curl -sf "$BASE/runs/$RUN_ID/artifacts" | json "[(a['type'], a['origin'], a['sizeBytes']) for a in d]"

echo "==> completion definition (mock evidence never counts)"
curl -sf "$BASE/tasks/$TASK_ID/artifacts" | json "d['dod']"

cat <<'EOF'

Demo complete. The server was stopped and the temporary data directory removed.

Full M1 loop (needs the Claude Code CLI installed and logged in):
  1. Re-run without the trap cleanup (or start `go run ./cmd/ateam serve` manually).
  2. Create an agent with runtime "claude".
  3. Start a run on a todo task, open /runs/<id> in the web UI and watch the
     stream-json events, the diff artifact and the system verification report.
  4. Approve the evidence in the review panel (an exception reason is required
     when test evidence is missing), then merge with an explicit confirmation.
EOF

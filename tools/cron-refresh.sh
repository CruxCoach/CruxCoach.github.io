#!/bin/bash
# Daily refresh of boards/data/boards.geojson from the upstream
# @hangtime/climbing-boards npm package. Commits + pushes if the dataset
# changed; logs to $HOME/.cache/cruxcoach-pages-cron/. Designed to be
# idempotent — re-running on an already-current dataset is a no-op.
#
# Crontab entry (the script picks its own log file by date):
#   30 3 * * * /home/<user>/cruxcoach-pages/tools/cron-refresh.sh
#
# Hangtime publishes around 02:30 UTC; 03:30 leaves enough headroom and
# lands before the blossom-sync cron at 04:00.

set -uo pipefail
umask 022

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/.cache/cruxcoach-pages-cron"
LOG_FILE="$LOG_DIR/refresh-$(date +%Y-%m-%d).log"
LOCK_FILE="$LOG_DIR/refresh.lock"

mkdir -p "$LOG_DIR"

# Prevent overlapping runs (cron skew, manual re-trigger).
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -Is)] another refresh already running, skipping" >> "$LOG_FILE"
  exit 0
fi

try_push() {
  # Codeberg occasionally drops SSH on the first attempt. Three tries with
  # backoff smooths over that without blocking the cron slot for too long.
  local attempt
  for attempt in 1 2 3; do
    if git push origin main; then return 0; fi
    echo "-- push attempt $attempt failed; sleeping then retrying"
    sleep $((attempt * 10))
  done
  echo "-- push failed after 3 attempts"
  return 1
}

run() {
  echo "=== boards.geojson refresh $(date -Is) ==="
  cd "$REPO_ROOT" || { echo "repo missing: $REPO_ROOT"; return 1; }

  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519_codeberg -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

  echo "-- syncing main with origin"
  git fetch --quiet origin main || { echo "git fetch failed"; return 1; }
  local current_branch
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$current_branch" != "main" ]; then
    echo "not on main (on $current_branch); skipping"
    return 0
  fi
  git merge --ff-only origin/main || { echo "main is not fast-forward — refusing to rebase"; return 1; }

  # Catch up: if a previous run committed locally but failed to push,
  # try pushing again before doing more work.
  if [ "$(git rev-list origin/main..HEAD --count)" -gt 0 ]; then
    echo "-- local is ahead of origin/main; attempting push"
    if ! try_push; then return 4; fi
  fi

  echo "-- running build-boards-data.mjs"
  /usr/bin/node tools/build-boards-data.mjs || { echo "build failed"; return 2; }

  # Only the data file is load-bearing for change detection — meta.json
  # has a fresh `generated_at` every build, so checking both would
  # produce a daily no-op commit even when upstream is unchanged.
  if git diff --quiet boards/data/boards.geojson; then
    echo "no dataset change; restoring meta.json + exiting"
    git checkout -- boards/data/boards.meta.json
    return 0
  fi

  local summary
  summary="$(/usr/bin/jq -r '"v" + .sources.hangtime.version + ", " + (.venue_features|tostring) + " venues (" + (.venues_with_multiple_boards|tostring) + " multi-board)"' boards/data/boards.meta.json)"

  echo "-- dataset changed: $summary"
  git add boards/data/boards.geojson boards/data/boards.meta.json
  git -c user.name=CruxCoach -c user.email=dev@cruxcoach.de \
      commit -m "data(boards): daily refresh — $summary" \
    || { echo "commit failed"; return 3; }
  if ! try_push; then return 4; fi

  echo "=== done $(date -Is) ==="
}

run >> "$LOG_FILE" 2>&1
rc=$?
echo "[exit rc=$rc]" >> "$LOG_FILE"

# Keep last 30 days of logs.
find "$LOG_DIR" -name 'refresh-*.log' -mtime +30 -delete 2>/dev/null || true

exit $rc

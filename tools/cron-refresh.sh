#!/bin/bash
# Daily refresh of (1) the site's direct APK download links against the
# newest Codeberg release (tools/update-download-link.mjs) and (2)
# boards/data/boards.geojson from the upstream @hangtime/climbing-boards
# npm package. Commits + pushes each change independently; logs to
# $HOME/.cache/cruxcoach-pages-cron/. Designed to be idempotent —
# re-running on an already-current state is a no-op.
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
INDEXNOW_STATE_FILE="$LOG_DIR/indexnow-main-head"

mkdir -p "$LOG_DIR"

# Prevent overlapping runs (cron skew, manual re-trigger).
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -Is)] another refresh already running, skipping" >> "$LOG_FILE"
  exit 0
fi

RELEASE_TAG=""

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

  # Direct-download links first (independent of the boards dataset): a new
  # app release moves the versioned APK URL, and the site must follow. On
  # API failure the old links are kept — they stay valid because old
  # release assets remain downloadable.
  echo "-- checking direct APK download links"
  local link_files=(
    index.html de/index.html 404.html llms.txt
    kilter-board-app-alternative.html de/kilter-board-app-alternative.html
    moonboard-app.html de/moonboard-app.html
  )
  if /usr/bin/node tools/update-download-link.mjs; then
    if ! git diff --quiet -- "${link_files[@]}"; then
      local apk_tag
      apk_tag="$(grep -oE 'releases/download/[^/]+/' index.html | head -1 | cut -d/ -f3)"
      echo "-- download links moved to ${apk_tag}"
      /usr/bin/node tools/update-sitemap-lastmod.mjs \
        index.html de/index.html \
        kilter-board-app-alternative.html de/kilter-board-app-alternative.html \
        moonboard-app.html de/moonboard-app.html \
        || { echo "sitemap lastmod update failed"; return 3; }
      git add "${link_files[@]}" sitemap.xml
      git -c user.name=CruxCoach -c user.email=dev@cruxcoach.de \
          commit -m "chore(download): bump direct APK link to ${apk_tag}" \
        || { echo "link commit failed"; return 3; }
      if ! try_push; then return 4; fi
      RELEASE_TAG="$apk_tag"
    fi
  else
    echo "-- download-link check failed; restoring links + continuing"
    git checkout -- "${link_files[@]}"
  fi

  echo "-- running build-boards-data.mjs"
  /usr/bin/node tools/build-boards-data.mjs || { echo "build failed"; return 2; }

  # Only the data file is load-bearing for change detection — meta.json
  # has a fresh `generated_at` every build, so checking both would
  # produce a daily no-op commit even when upstream is unchanged. The
  # generated HTML (boards/list.html + the injected block in
  # boards/index.html) is a pure function of the data with no timestamp,
  # so it changes if and only if boards.geojson does.
  if git diff --quiet boards/data/boards.geojson; then
    echo "no dataset change; restoring generated files + exiting"
    git checkout -- boards/data/boards.meta.json boards/list.html boards/index.html
    return 0
  fi

  local summary
  summary="$(/usr/bin/jq -r '"v" + .sources.hangtime.version + ", " + (.venue_features|tostring) + " venues (" + (.venues_with_multiple_boards|tostring) + " multi-board)"' boards/data/boards.meta.json)"

  echo "-- dataset changed: $summary"
  /usr/bin/node tools/update-sitemap-lastmod.mjs boards/index.html boards/list.html \
    || { echo "sitemap lastmod update failed"; return 3; }
  git add boards/data/boards.geojson boards/data/boards.meta.json \
    boards/list.html boards/index.html sitemap.xml
  git -c user.name=CruxCoach -c user.email=dev@cruxcoach.de \
      commit -m "data(boards): daily refresh — $summary" \
    || { echo "commit failed"; return 3; }
  if ! try_push; then return 4; fi

  echo "=== done $(date -Is) ==="
}

sync_mirror() {
  # Keep the GitHub Pages mirror (CruxCoach/CruxCoach.github.io →
  # https://cruxcoach.github.io, listed in mirrors.json) in sync.
  # Non-fatal by design: a dead mirror must never block the main refresh.
  cd "$REPO_ROOT" || return 0
  echo "-- syncing GitHub Pages mirror"
  # run() exports GIT_SSH_COMMAND with the Codeberg key — override with
  # the GitHub deploy key for this push.
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519_github_pages -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
  local attempt
  for attempt in 1 2 3; do
    if git push github main; then return 0; fi
    echo "-- mirror push attempt $attempt failed; retrying"
    sleep $((attempt * 10))
  done
  echo "-- mirror push failed after 3 attempts (non-fatal)"
}

notify_indexnow() {
  # Track the deployed main commit independently from this process's pushes.
  # This catches Codeberg UI merges and other external deployments on the next
  # nightly run, while a failed submission remains pending for retry.
  cd "$REPO_ROOT" || return 1
  local deployed_head local_head recorded_head state_tmp
  deployed_head="$(git rev-parse --verify refs/remotes/origin/main 2>/dev/null)" \
    || { echo "-- indexnow: origin/main unavailable; deferring"; return 1; }
  local_head="$(git rev-parse --verify HEAD 2>/dev/null)" \
    || { echo "-- indexnow: local HEAD unavailable; deferring"; return 1; }
  if [ "$local_head" != "$deployed_head" ]; then
    echo "-- indexnow: local main does not match origin/main; deferring"
    return 1
  fi
  if ! git diff --quiet HEAD -- sitemap.xml; then
    echo "-- indexnow: sitemap.xml has local changes; deferring"
    return 1
  fi

  recorded_head=""
  if [ -f "$INDEXNOW_STATE_FILE" ]; then
    IFS= read -r recorded_head < "$INDEXNOW_STATE_FILE" || true
  fi
  if [ "$recorded_head" = "$deployed_head" ]; then
    echo "-- indexnow: deployed main already submitted (${deployed_head:0:12})"
    return 0
  fi

  echo "-- indexnow: new deployed main ${recorded_head:0:12} → ${deployed_head:0:12}"
  "$REPO_ROOT/tools/indexnow-ping.sh" || return 1
  state_tmp="$(mktemp "${INDEXNOW_STATE_FILE}.tmp.XXXXXX")" || return 1
  printf '%s\n' "$deployed_head" > "$state_tmp"
  mv "$state_tmp" "$INDEXNOW_STATE_FILE"
  echo "-- indexnow: recorded deployed main ${deployed_head:0:12}"
}

run >> "$LOG_FILE" 2>&1
rc=$?
sync_mirror >> "$LOG_FILE" 2>&1

# Nudge search engines after any new deployed main commit, including changes
# merged outside this cron process. Non-fatal; failures retry on the next run.
notify_indexnow >> "$LOG_FILE" 2>&1 || true

# A new app release moved the download links → archive the whole site in
# the Wayback Machine, once per release only (anonymous SPN is rate-limited
# and the site barely changes in between). The script waits until the new
# tag is actually live on Pages before capturing. Non-fatal.
if [ -n "$RELEASE_TAG" ]; then
  "$REPO_ROOT/tools/wayback-save.sh" "$RELEASE_TAG" >> "$LOG_FILE" 2>&1 || true
fi

echo "[exit rc=$rc]" >> "$LOG_FILE"

# Keep last 30 days of logs.
find "$LOG_DIR" -name 'refresh-*.log' -mtime +30 -delete 2>/dev/null || true

exit $rc

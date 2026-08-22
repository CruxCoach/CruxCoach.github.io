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
OSM_HOURS_STATE_FILE="$LOG_DIR/osm-hours-last-check"
# How long between OpenStreetMap reads. Opening hours change a few times a
# year, so weekly is generous; the point of the stamp file is that a run which
# finds nothing changed leaves no trace in the repository and still does not
# re-read OpenStreetMap the next night.
OSM_HOURS_INTERVAL_DAYS="${CRUXCOACH_OSM_HOURS_INTERVAL_DAYS:-7}"

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

  # Direct-download links first (independent of the boards dataset). The
  # release workflow already runs this same script the moment a release
  # exists, so on most nights it finds nothing to do. It still runs, because
  # it is what repairs a release published while this host was down.
  #
  # Shared with the workflow rather than reimplemented: the file list used to
  # live here as a hand-written array, and it silently lost both
  # tension-board pages — the updater rewrote them, this never staged them.
  local before after
  before="$(git rev-parse HEAD)"
  tools/publish-release.sh
  case "$?" in
    0) ;;
    3) return 4 ;;               # commit exists, push failed — same as before
    *) echo "-- download-link publish failed; continuing with boards" ;;
  esac
  after="$(git rev-parse HEAD)"
  if [ "$before" != "$after" ]; then
    RELEASE_TAG="$(grep -oE 'releases/download/[^/]+/' index.html | head -1 | cut -d/ -f3)"
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
    git checkout -- boards/data/boards.meta.json \
      boards/list.html boards/index.html \
      de/boards/list.html de/boards/index.html
    return 0
  fi

  local summary
  summary="$(/usr/bin/jq -r '"v" + .sources.hangtime.version + ", " + (.venue_features|tostring) + " venues (" + (.venues_with_multiple_boards|tostring) + " multi-board)"' boards/data/boards.meta.json)"

  echo "-- dataset changed: $summary"
  /usr/bin/node tools/update-sitemap-lastmod.mjs boards/index.html boards/list.html \
    || { echo "sitemap lastmod update failed"; return 3; }
  git add boards/data/boards.geojson boards/data/boards.meta.json \
    boards/list.html boards/index.html \
    de/boards/list.html de/boards/index.html sitemap.xml
  git -c user.name=CruxCoach -c user.email=dev@cruxcoach.de \
      commit -m "data(boards): daily refresh — $summary" \
    || { echo "commit failed"; return 3; }
  if ! try_push; then return 4; fi

  echo "=== done $(date -Is) ==="
}

refresh_osm_hours() {
  # Opening hours for the hand-curated venues in tools/osm-venues.json.
  # OFF unless CRUXCOACH_OSM_HOURS=1 — this reads a third-party API on a
  # schedule, so switching it on is a deliberate operator decision, not
  # something that starts happening because this script was updated. See
  # tools/dev/RUNBOOK-osm-opening-hours.md.
  #
  # Runs after run(), inheriting the git transport it already configured.
  [ "${CRUXCOACH_OSM_HOURS:-0}" = "1" ] || return 0
  cd "$REPO_ROOT" || return 0

  if [ -f "$OSM_HOURS_STATE_FILE" ] &&
     [ -z "$(find "$OSM_HOURS_STATE_FILE" -mtime "+$((OSM_HOURS_INTERVAL_DAYS - 1))")" ]; then
    echo "-- osm hours: checked less than ${OSM_HOURS_INTERVAL_DAYS}d ago; skipping"
    return 0
  fi

  echo "-- osm hours: reading OpenStreetMap for the curated venues"
  local result
  # --force because the schedule lives in the stamp file above: a run that
  # changed nothing is reverted below, so the timestamp inside the committed
  # sidecar cannot be used to pace this.
  if ! result="$(/usr/bin/node tools/refresh-osm-hours.mjs --force)"; then
    echo "-- osm hours: refresh failed (non-fatal, retried in the next window)"
    git checkout -- boards/data/osm-opening-hours.json 2>/dev/null || true
    return 0
  fi
  echo "-- osm hours: $result"
  # A successful read counts as a check even when nothing moved.
  touch "$OSM_HOURS_STATE_FILE"

  case "$result" in
    *"result: changed"*) ;;
    *)
      # Only the "last checked" timestamp moved. Dropping it keeps the
      # repository free of daily no-op commits.
      git checkout -- boards/data/osm-opening-hours.json 2>/dev/null || true
      return 0
      ;;
  esac

  # The venues did not move, only the text under them — re-render the static
  # directories from what is already committed, without pulling upstream.
  if ! /usr/bin/node tools/build-boards-data.mjs --static-only; then
    echo "-- osm hours: static re-render failed; reverting"
    git checkout -- boards/data/osm-opening-hours.json boards/list.html de/boards/list.html 2>/dev/null || true
    return 0
  fi
  /usr/bin/node tools/update-sitemap-lastmod.mjs boards/list.html de/boards/list.html \
    || echo "-- osm hours: sitemap lastmod update failed; continuing"

  git add boards/data/osm-opening-hours.json boards/list.html de/boards/list.html sitemap.xml
  git -c user.name=CruxCoach -c user.email=dev@cruxcoach.de \
      commit -m "data(osm): refresh venue opening hours from OpenStreetMap" \
    || { echo "-- osm hours: commit failed"; return 0; }
  try_push || echo "-- osm hours: push failed; the next run retries it"
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
refresh_osm_hours >> "$LOG_FILE" 2>&1
sync_mirror >> "$LOG_FILE" 2>&1

# The apex certificate, on every host that serves it. Cheap, and the only way a
# lapse gets noticed before visitors do — see the script for why a lapse is
# plausible at all once more than one provider answers for the domain.
"$REPO_ROOT/tools/check-apex-certs.sh" >> "$LOG_FILE" 2>&1 \
  || echo "[$(date -Is)] apex certificate check reported a problem" >> "$LOG_FILE"

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

#!/bin/bash
# Bring the website in step with the newest Codeberg release, and commit+push
# if that moved anything.
#
# Two callers, deliberately the same code path:
#
#   1. The release workflow (.forgejo/workflows/release.yml in the app repo)
#      calls this the moment a release exists. That is what closes the gap —
#      the site used to learn about a release only at the next nightly run,
#      so for up to a day it advertised the previous version and the selector
#      served an APK nobody had just been told about.
#
#   2. tools/cron-refresh.sh still calls it nightly. Not redundant: it repairs
#      a release published while this host was down, a push that failed, or a
#      local APK copy that went missing.
#
# Idempotent by construction: with nothing to move it makes no commit, so the
# nightly run stays silent and the release run does the real work.
#
# Usage: tools/publish-release.sh
# Exit:  0 nothing to do or published; 1 update failed; 2 commit failed;
#        3 push failed.

set -uo pipefail
umask 022

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || { echo "repo missing: $REPO_ROOT"; exit 1; }

NODE_BIN="${NODE_BIN:-/usr/bin/node}"

# Only set a key when the caller has not. The release runner and the cron both
# push as the same account, but a developer running this by hand should keep
# whatever their own git config says.
if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -f "$HOME/.ssh/id_ed25519_codeberg" ]; then
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519_codeberg -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
fi

try_push() {
  # Codeberg occasionally drops SSH on the first attempt.
  local attempt
  for attempt in 1 2 3; do
    if git push origin main; then return 0; fi
    echo "-- push attempt $attempt failed; sleeping then retrying"
    sleep $((attempt * 10))
  done
  echo "-- push failed after 3 attempts"
  return 1
}

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "not on main (on $branch); skipping"
  exit 0
fi

# Sync before touching anything. The release workflow calls this straight out
# of its own checkout and has no idea what state this working copy is in; a
# stale main would only reveal itself as a rejected push after the commit.
git fetch --quiet origin main || { echo "git fetch failed"; exit 1; }
git merge --ff-only origin/main \
  || { echo "main is not fast-forward — refusing to rewrite it"; exit 1; }

# The single source of truth for what the updater may rewrite.
mapfile -t LINK_FILES < <("$NODE_BIN" tools/update-download-link.mjs --print-files)
if [ "${#LINK_FILES[@]}" -eq 0 ]; then
  echo "could not determine the file list"
  exit 1
fi

echo "-- checking direct APK download links"
if ! "$NODE_BIN" tools/update-download-link.mjs; then
  # Old links stay valid: previous release assets remain downloadable, so a
  # failed check is better left as a no-op than as a half-applied bump.
  echo "-- download-link check failed; restoring links"
  git checkout -- "${LINK_FILES[@]}"
  exit 1
fi

if git diff --quiet -- "${LINK_FILES[@]}"; then
  echo "-- links already current"
  exit 0
fi

apk_tag="$(grep -oE 'releases/download/[^/]+/' index.html | head -1 | cut -d/ -f3)"
echo "-- download links moved to ${apk_tag}"

# Only the pages a reader can open; llms.txt and the manifest are not in the
# sitemap, and 404.html is deliberately not indexable.
sitemap_pages=()
for file in "${LINK_FILES[@]}"; do
  case "$file" in
    *.html) [ "$file" = "404.html" ] || sitemap_pages+=("$file") ;;
  esac
done
"$NODE_BIN" tools/update-sitemap-lastmod.mjs "${sitemap_pages[@]}" \
  || { echo "sitemap lastmod update failed"; exit 2; }

git add "${LINK_FILES[@]}" sitemap.xml
git -c user.name=CruxCoach -c user.email=dev@cruxcoach.de \
    commit -m "chore(download): bump direct APK link to ${apk_tag}" \
  || { echo "link commit failed"; exit 2; }

try_push || exit 3

# The mirror carries the same release or it is not a mirror. The nightly cron
# syncs it too, but waiting for that would leave a window in which Codeberg has
# the new version and the fallback still serves the old one — exactly the hours
# after a release, when a Codeberg outage would hurt most.
#
# Non-fatal: the release is out and the site is correct; a stale mirror is a
# degraded fallback, not a broken download.
echo "-- syncing GitHub Pages mirror"
if [ -f "$HOME/.ssh/id_ed25519_github_pages" ]; then
  mirror_attempt=1
  while [ "$mirror_attempt" -le 3 ]; do
    if GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519_github_pages -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
         git push github main; then
      break
    fi
    echo "-- mirror push attempt $mirror_attempt failed"
    mirror_attempt=$((mirror_attempt + 1))
    sleep $((mirror_attempt * 5))
  done
  [ "$mirror_attempt" -le 3 ] || echo "-- mirror push failed (non-fatal)"
else
  echo "-- no GitHub deploy key here; mirror left to the nightly refresh"
fi

echo "-- published ${apk_tag}"

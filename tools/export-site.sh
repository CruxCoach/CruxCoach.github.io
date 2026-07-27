#!/bin/bash
# Export the published branch into the directory our own web server serves.
#
# Why an export and not the checkout. Codeberg Pages serves the *committed
# branch*; a web server pointed at this repository would serve the *directory
# on disk*. Those differ by exactly the files .gitignore lists — .env, the
# Wellpass matcher, and anything matching *nsec* or nostr-key*. One stray key
# file in this folder and it would be public at cruxcoach.org/<name> within the
# second, with no error anywhere to notice it by. A leaked nsec cannot be
# revoked.
#
# `git archive` cannot make that mistake: it can only contain what is committed.
# Untracked and ignored files do not exist as far as it is concerned.
#
# The swap is a symlink move, so a request never lands in a half-written tree.
#
# Usage: tools/export-site.sh [target-dir]      (default ~/cruxcoach-site)
# Exit:  0 exported or already current; 1 refused; 2 export failed.

set -uo pipefail
umask 022

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$HOME/cruxcoach-site}"
REF="${SITE_EXPORT_REF:-origin/main}"

cd "$REPO_ROOT" || { echo "repo missing: $REPO_ROOT"; exit 1; }

commit="$(git rev-parse --verify "$REF" 2>/dev/null)" || {
  echo "cannot resolve $REF"; exit 1; }

# Serve only what is actually published. Exporting local commits would put
# content on our address that the other provider does not have, and the two
# would disagree about what the site says.
if [ "$REF" = "origin/main" ]; then
  head="$(git rev-parse --verify HEAD 2>/dev/null)"
  if [ "$head" != "$commit" ]; then
    echo "note: HEAD differs from $REF — exporting $REF, the published state"
  fi
fi

mkdir -p "$TARGET" || { echo "cannot create $TARGET"; exit 1; }
current="$TARGET/current"
release="$TARGET/rel-${commit:0:12}"

if [ "$(readlink -f "$current" 2>/dev/null)" = "$(readlink -f "$release" 2>/dev/null)" ] \
   && [ -d "$release" ]; then
  echo "already serving ${commit:0:12}"
  exit 0
fi

staging="$(mktemp -d "$TARGET/.staging.XXXXXX")" || exit 2
trap 'rm -rf "$staging"' EXIT

git archive --format=tar "$commit" | tar -x -C "$staging" || {
  echo "git archive failed"; exit 2; }

# A published site without an index page is a deployment accident, not a site.
[ -s "$staging/index.html" ] || { echo "export has no index.html — refusing"; exit 2; }

rm -rf "$release"
mv "$staging" "$release" || { echo "could not place $release"; exit 2; }
trap - EXIT
chmod -R a+rX "$release"

# Atomic: the symlink is replaced in one rename, so a request either sees the
# old tree or the new one, never a mixture.
# Relative target on purpose: the directory is bind-mounted into the web
# server's container under a different path, and an absolute symlink would
# point at a path that does not exist in there.
ln -sfn "rel-${commit:0:12}" "$TARGET/.current.tmp" \
  && mv -Tf "$TARGET/.current.tmp" "$current" \
  || { echo "could not swap the symlink"; exit 2; }

# Keep one previous release for a quick manual rollback, drop older ones.
# shellcheck disable=SC2012
ls -1dt "$TARGET"/rel-* 2>/dev/null | tail -n +3 | while read -r old; do
  [ "$old" = "$release" ] || rm -rf "$old"
done

echo "serving ${commit:0:12} from $current"

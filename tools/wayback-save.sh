#!/bin/bash
# Archive every sitemap URL + llms.txt in the Internet Archive's Wayback
# Machine via the anonymous Save Page Now endpoint (no account). Intended
# to run once per app release — NOT nightly: anonymous SPN is tightly
# rate-limited and the site barely changes between releases.
#
# Usage: tools/wayback-save.sh [expected-string]
# If expected-string is given (e.g. the new release tag "v0.3.0"), the
# script first waits until the live homepage contains it — Codeberg Pages
# deploys minutes after the push, and archiving too early would freeze the
# pre-release state. After 15 minutes it proceeds anyway with a warning.
#
# Callers should treat failure as non-fatal (|| true): a missed archive
# run can simply be repeated by hand.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="cruxcoach.org"

expected="${1:-}"
if [ -n "$expected" ]; then
  echo "-- wayback: waiting for live homepage to contain '$expected'"
  deployed=0
  for _ in $(seq 1 30); do
    if curl -s --max-time 20 "https://$HOST/" | grep -qF "$expected"; then
      deployed=1
      break
    fi
    sleep 30
  done
  if [ "$deployed" -eq 1 ]; then
    echo "-- wayback: live site is current"
  else
    echo "-- wayback: '$expected' not live after 15 min; archiving anyway"
  fi
fi

urls="$(grep -oE '<loc>[^<]+</loc>' "$REPO_ROOT/sitemap.xml" | sed -E 's|</?loc>||g')"
if [ -z "$urls" ]; then
  echo "wayback: no <loc> entries found in sitemap.xml; skipping"
  exit 1
fi
urls="$urls
https://$HOST/llms.txt"

failed=0
for u in $urls; do
  status="$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 90 \
    "https://web.archive.org/save/$u")" || status="000"
  echo "-- wayback: $u → HTTP $status"
  [ "$status" = "200" ] || failed=$((failed + 1))
  sleep 25   # stay well inside the anonymous SPN rate limit
done

if [ "$failed" -gt 0 ]; then
  echo "-- wayback: $failed capture(s) not confirmed (can be re-run by hand)"
  exit 1
fi
echo "-- wayback: all captures accepted"

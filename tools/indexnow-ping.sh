#!/bin/bash
# Submit every indexable URL from sitemap.xml to IndexNow
# (https://www.indexnow.org/) so Bing, Yandex, Seznam, Naver etc. re-crawl
# after a content push — no webmaster account, no auth. Ownership is proven
# by the key file at the domain root (<key>.txt containing the key itself),
# which is committed in this repo and served by Codeberg Pages.
#
# Usage: tools/indexnow-ping.sh
# Callers should treat failure as non-fatal (|| true): a missed ping only
# delays re-crawling; the sitemap still covers discovery.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="cruxcoach.org"
ENDPOINT="https://api.indexnow.org/indexnow"

# The key file is the 32-hex-named .txt at the repo root whose content is
# the key itself. Located by pattern so a key rotation needs no code change.
key_file="$(find "$REPO_ROOT" -maxdepth 1 -regextype posix-extended \
  -regex '.*/[0-9a-f]{32}\.txt' -print -quit)"
if [ -z "$key_file" ]; then
  echo "indexnow: no key file (<32-hex>.txt) at repo root; skipping"
  exit 1
fi
key="$(tr -d '[:space:]' < "$key_file")"
if [ "$key" != "$(basename "$key_file" .txt)" ]; then
  echo "indexnow: key file content does not match its filename; skipping"
  exit 1
fi

urls="$(grep -oE '<loc>[^<]+</loc>' "$REPO_ROOT/sitemap.xml" | sed -E 's|</?loc>||g')"
if [ -z "$urls" ]; then
  echo "indexnow: no <loc> entries found in sitemap.xml; skipping"
  exit 1
fi

payload="$(printf '%s\n' "$urls" | /usr/bin/jq -R . | /usr/bin/jq -s \
  --arg host "$HOST" \
  --arg key "$key" \
  --arg keyLocation "https://$HOST/$(basename "$key_file")" \
  '{host: $host, key: $key, keyLocation: $keyLocation, urlList: .}')"

echo "-- indexnow: submitting $(printf '%s\n' "$urls" | wc -l) URLs for $HOST"
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
  -X POST -H 'Content-Type: application/json; charset=utf-8' \
  -d "$payload" "$ENDPOINT")" || { echo "indexnow: request failed"; exit 1; }

case "$status" in
  200|202) echo "-- indexnow: accepted (HTTP $status)"; exit 0 ;;
  *)       echo "-- indexnow: rejected (HTTP $status)"; exit 1 ;;
esac

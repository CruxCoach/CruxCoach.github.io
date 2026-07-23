#!/bin/bash
# Submit changed indexable URLs to IndexNow
# (https://www.indexnow.org/) so Bing, Yandex, Seznam, Naver etc. re-crawl
# after a content push — no webmaster account, no auth. Ownership is proven
# by the key file at the domain root (<key>.txt containing the key itself),
# which is committed in this repo and served by Codeberg Pages.
#
# With no URL arguments, every <loc> from sitemap.xml is submitted. Pass one or
# more absolute cruxcoach.org URLs to notify only those pages. --dry-run performs
# all validation and prints the selected URLs without contacting IndexNow.
#
# Usage: tools/indexnow-ping.sh [--dry-run] [https://cruxcoach.org/path ...]
# Callers should treat failure as non-fatal (|| true): a missed ping only
# delays re-crawling; the sitemap still covers discovery.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="cruxcoach.org"
ENDPOINT="https://api.indexnow.org/indexnow"

dry_run=0
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=1
  shift
fi
if [ "${1:-}" = "--help" ]; then
  echo "usage: tools/indexnow-ping.sh [--dry-run] [https://$HOST/path ...]"
  exit 0
fi

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

declare -a candidates=()
if [ "$#" -gt 0 ]; then
  candidates=("$@")
else
  mapfile -t candidates < <(
    grep -oE '<loc>[^<]+</loc>' "$REPO_ROOT/sitemap.xml" | sed -E 's|</?loc>||g'
  )
fi
if [ "${#candidates[@]}" -eq 0 ]; then
  echo "indexnow: no <loc> entries found in sitemap.xml; skipping"
  exit 1
fi

declare -A seen=()
declare -a urls=()
for url in "${candidates[@]}"; do
  case "$url" in
    "https://$HOST"|"https://$HOST/"*) ;;
    *)
      echo "indexnow: URL must use https://$HOST/: $url"
      exit 1
      ;;
  esac
  if [ -z "${seen[$url]+x}" ]; then
    seen[$url]=1
    urls+=("$url")
  fi
done
if [ "${#urls[@]}" -gt 10000 ]; then
  echo "indexnow: refusing more than 10000 URLs in one request"
  exit 1
fi

payload="$(printf '%s\n' "${urls[@]}" | /usr/bin/jq -R . | /usr/bin/jq -s \
  --arg host "$HOST" \
  --arg key "$key" \
  --arg keyLocation "https://$HOST/$(basename "$key_file")" \
  '{host: $host, key: $key, keyLocation: $keyLocation, urlList: .}')"

if [ "$dry_run" -eq 1 ]; then
  echo "-- indexnow: dry run would submit ${#urls[@]} URLs for $HOST"
  printf '%s\n' "${urls[@]}"
  exit 0
fi

echo "-- indexnow: submitting ${#urls[@]} URLs for $HOST"
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
  -X POST -H 'Content-Type: application/json; charset=utf-8' \
  -d "$payload" "$ENDPOINT")" || { echo "indexnow: request failed"; exit 1; }

case "$status" in
  200|202) echo "-- indexnow: accepted (HTTP $status)"; exit 0 ;;
  *)       echo "-- indexnow: rejected (HTTP $status)"; exit 1 ;;
esac

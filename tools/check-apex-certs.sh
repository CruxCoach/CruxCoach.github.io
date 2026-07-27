#!/bin/bash
# Watch the TLS certificate on every host that answers for cruxcoach.org.
#
# Why this exists. The apex is served by two providers at once (Codeberg Pages
# and GitHub Pages) so that a browser can fail over between them in seconds
# without any DNS change. The price is that both obtain their certificates from
# Let's Encrypt by proving control over the domain — and a validation attempt
# reaches the right provider only as often as DNS happens to point there. With
# five addresses and one of them Codeberg's, a Codeberg renewal succeeds on
# roughly one attempt in five.
#
# Both sides retry for days, so it normally works. When it does not, the result
# is the worst kind of failure: silent, partial, and a scary browser warning
# for the share of visitors who land on the lapsed host.
#
# So the certificates are watched, not hoped for. If one gets close to expiry,
# the rescue is to remove the *other* provider's A records for an hour: the
# lapsing host then wins every validation attempt, renews, and the records go
# back. That is a five-minute fix — provided somebody knows in time.
#
# Addresses are read from DNS rather than configured here, so this covers
# whatever is actually serving the domain today.
#
# Usage: tools/check-apex-certs.sh [domain] [warn-days]
# Exit:  0 all good; 1 something needs attention.

set -uo pipefail

DOMAIN="${1:-cruxcoach.org}"
WARN_DAYS="${2:-21}"
problems=0

# Both families. Dual-stack browsers prefer IPv6, so an unchecked AAAA is the
# address most visitors would actually land on.
addresses="$(dig +short A "$DOMAIN" | grep -E '^[0-9.]+$')"
addresses="$addresses
$(dig +short AAAA "$DOMAIN" | grep -E '^[0-9a-fA-F:]+$')"
addresses="$(echo "$addresses" | grep -v '^$')"
if [ -z "$addresses" ]; then
  echo "FAIL $DOMAIN has no A or AAAA records at all — DNS is the problem, not TLS"
  exit 1
fi

echo "== $DOMAIN: $(echo "$addresses" | wc -l) address(es) serving the apex"

for ip in $addresses; do
  # openssl needs an IPv6 literal in brackets to tell address from port.
  case "$ip" in *:*) target="[$ip]" ;; *) target="$ip" ;; esac
  cert="$(echo \
    | timeout 15 openssl s_client -connect "$target:443" -servername "$DOMAIN" 2>/dev/null \
    | openssl x509 -noout -enddate -subject -ext subjectAltName 2>/dev/null)"

  if [ -z "$cert" ]; then
    echo "FAIL $ip  no usable certificate — visitors routed here see a TLS error"
    problems=$((problems + 1))
    continue
  fi

  # A certificate that is valid but for a different name is just as broken from
  # the visitor's side, and is exactly what a provider serves before it has
  # been given the domain.
  if ! grep -q "DNS:$DOMAIN\b" <<<"$cert"; then
    echo "FAIL $ip  certificate does not cover $DOMAIN"
    problems=$((problems + 1))
    continue
  fi

  end="$(sed -n 's/^notAfter=//p' <<<"$cert")"
  end_epoch="$(date -d "$end" +%s 2>/dev/null)" || end_epoch=""
  if [ -z "$end_epoch" ]; then
    echo "WARN $ip  could not read the expiry date ($end)"
    problems=$((problems + 1))
    continue
  fi

  days=$(( (end_epoch - $(date +%s)) / 86400 ))
  if [ "$days" -lt "$WARN_DAYS" ]; then
    echo "WARN $ip  expires in ${days}d ($end) — this host is losing the renewal race"
    echo "     remedy: drop the other provider's A records for an hour so this"
    echo "     one wins every Let's Encrypt validation, then restore them"
    problems=$((problems + 1))
  else
    echo "ok   $ip  expires in ${days}d"
  fi
done

exit $(( problems > 0 ? 1 : 0 ))

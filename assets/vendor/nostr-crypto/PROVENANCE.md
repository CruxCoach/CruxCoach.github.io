# Vendored cryptography — provenance

The site takes **no runtime external dependency**: nothing here is fetched from
a CDN, and these files are served from this origin like every other asset. That
is the same rule `assets/vendor/leaflet/` follows.

These two libraries are vendored rather than written locally because
secp256k1 Schnorr signing (BIP-340) and ChaCha20 are not primitives anyone
should hand-roll, and neither exists in WebCrypto. Everything they do **not**
provide — SHA-256, HMAC-SHA256, HKDF, PBKDF2, AES-GCM, random bytes — comes from
the platform's own `crypto.subtle`, not from a library.

Both are used unmodified. Not one byte was edited: a patched copy of an audited
library is an unaudited library.

| | |
|---|---|
| **Package** | `@noble/secp256k1` |
| **Version** | 3.1.0 |
| **License** | MIT (`secp256k1/LICENSE-noble-secp256k1`) |
| **Author** | Paul Miller (paulmillr.com) |
| **Upstream** | https://github.com/paulmillr/noble-secp256k1 |
| **Fetched from** | `https://registry.npmjs.org/@noble/secp256k1/-/secp256k1-3.1.0.tgz` |
| **Tarball SHA-256** | `f5d5f57083b71143291b3bc9aa9ea48a03313337c93d41a31d70b90224b57f74` |
| **Runtime dependencies** | none |
| **Files kept** | `index.js` → `secp256k1/secp256k1.js`, `LICENSE` |
| **Used for** | BIP-340 Schnorr sign/verify (Nostr event signatures) and ECDH (NIP-44 conversation keys) |
| **Retrieved** | 2026-08-09 |

| | |
|---|---|
| **Package** | `@noble/ciphers` |
| **Version** | 2.3.0 |
| **License** | MIT (`ciphers/LICENSE-noble-ciphers`) |
| **Author** | Paul Miller (paulmillr.com) |
| **Upstream** | https://github.com/paulmillr/noble-ciphers |
| **Fetched from** | `https://registry.npmjs.org/@noble/ciphers/-/ciphers-2.3.0.tgz` |
| **Tarball SHA-256** | `c6766270d5a1bef86c02b253c6d4dfbf3a557c9a1a229830f08f55bbdae335f4` |
| **Runtime dependencies** | none |
| **Files kept** | `chacha.js`, `_arx.js`, `utils.js`, `_poly1305.js` (the import closure of `chacha20`) |
| **Used for** | ChaCha20, which NIP-44 v2 requires and WebCrypto does not offer. NIP-44 is needed for NIP-46 remote signing. |
| **Retrieved** | 2026-08-09 |

`_poly1305.js` is included because `chacha.js` imports it at module scope. NIP-44
uses raw ChaCha20 with a separate HMAC-SHA256, not ChaCha20-Poly1305, so Poly1305
is never actually called on our paths — it is present to keep the vendored module
byte-identical to upstream rather than a trimmed fork.

## Why these, and why this way

`nostr-tools` and `NDK` are the usual choices and both are good. Both were
rejected here: they pull a dependency tree (NDK 2.18.1 → `nostr-tools` →
`@noble/*` + `@scure/*`), they assume a bundler, and vendoring a tree is how a
"vendored" directory quietly becomes unauditable. Two dependency-free files with
a recorded digest can be checked by hand.

## Verifying this copy

```bash
curl -sL https://registry.npmjs.org/@noble/secp256k1/-/secp256k1-3.1.0.tgz | sha256sum
curl -sL https://registry.npmjs.org/@noble/ciphers/-/ciphers-2.3.0.tgz     | sha256sum
```

The vendored files must be byte-identical to `package/index.js` and to
`package/{chacha,_arx,utils,_poly1305}.js` inside those tarballs.

Correctness is not taken on trust either: `tools/nostr-crypto.test.mjs` runs the
official BIP-340 test vectors and the RFC 8439 ChaCha20 vector against this exact
copy, so an accidental truncation or a bad re-vendor fails `scripts/check`.

## Upgrading

Re-download, replace the files, update the version and digest above, and run
`scripts/check`. Never edit a file in place.

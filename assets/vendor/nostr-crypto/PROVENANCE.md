# Vendored cryptography — provenance

The site takes **no runtime external dependency**: nothing here is fetched from
a CDN, and these files are served from this origin like every other asset. That
is the same rule `assets/vendor/leaflet/` follows.

These two libraries are vendored rather than written locally because
secp256k1 Schnorr signing (BIP-340) and ChaCha20 are not primitives anyone
should hand-roll, and neither exists in WebCrypto. Everything they do **not**
provide — SHA-256, HMAC-SHA256, HKDF, PBKDF2, AES-GCM, random bytes — comes from
the platform's own `crypto.subtle`, not from a library.

NIP-49 additionally requires scrypt, so its audited implementation is vendored
from the same Noble project rather than recreated here.

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
| **Package** | `@noble/hashes` |
| **Version** | 2.0.1 |
| **License** | MIT (`hashes/LICENSE`) |
| **Author** | Paul Miller (paulmillr.com) |
| **Upstream** | https://github.com/paulmillr/noble-hashes |
| **Fetched from** | `https://registry.npmjs.org/@noble/hashes/-/hashes-2.0.1.tgz` |
| **Tarball SHA-256** | `638ffb3053a7e7478c9e54a6e297f3601299ee570a41112e501af7050d086a0a` |
| **Runtime dependencies** | none |
| **Files kept** | `scrypt.js` and its complete local import closure: `pbkdf2.js`, `hmac.js`, `sha2.js`, `_md.js`, `_u64.js`, `utils.js`; `LICENSE` |
| **Used for** | NIP-49 scrypt key derivation for portable `ncryptsec` backups |
| **Retrieved** | 2026-08-13 |

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

## Per-file digests

Every file here is byte-identical to its upstream release. `tools/nostr-crypto.test.mjs`
asserts these, which is why `.gitattributes` exempts `assets/vendor/**` from
`git diff --check`: upstream ships a few lines with trailing whitespace, and
stripping them would be a silent local modification of an audited library.

```
e0d1bad238ceef8d5451713daf6d5b256ce871d3200fe7ee79dbc01179ec806a  secp256k1/secp256k1.js
bcd2c8e9d3a9252022c74185340d69d724d2c2eed191f5599a2cec5005507d93  ciphers/_arx.js
5f1c00575e227b75163f4bac50b79442dec50ee3047c46c18887808ba8af0a69  ciphers/chacha.js
5d2afd73b40dbafb7b6740c6e6388e7123c79a4e57306861b28c5734925fa84d  ciphers/_poly1305.js
08bce2a6b116205e0d114ed3da22490384d933c6549f0b1a43e2817349465147  ciphers/utils.js
4f221aee6e072336700c408c68ab3b96a3fc09f6aebe6f48f1bd99e5ef13faec  hashes/LICENSE
a112f0fe1b15db00f2638618c436a17be1c5e13baf19d02fcc29016ae1db2233  hashes/_md.js
e48c0cfc10810439a4807b46db136ce603a3fa09b62584f513ef2f3ca496af54  hashes/_u64.js
b834a4e7ffecb7847fd87ebd792f7fdd13003d448acee5e8d97a6b77b8620797  hashes/hmac.js
d971ad41b21ebfe9c5d61897ef6b3d669e17cf5524c94f03b01c8c2c120caa22  hashes/pbkdf2.js
cce8f569bb8000d99e1e747be4ef1e49fed7cfadd2f249ac542ee2854ef359a9  hashes/scrypt.js
3ddc587c588283cbceed4dd9929cefcce06a0c231b54d4c6f0f99c478c686c00  hashes/sha2.js
11319ec0a8132a0c2ced8c98af33ae9274c001d6baf4f4709c4a6115e031a3c5  hashes/utils.js
```

Reproduce with:

```bash
sha256sum assets/vendor/nostr-crypto/secp256k1/secp256k1.js \
          assets/vendor/nostr-crypto/ciphers/*.js
```

## Verifying this copy

```bash
curl -sL https://registry.npmjs.org/@noble/secp256k1/-/secp256k1-3.1.0.tgz | sha256sum
curl -sL https://registry.npmjs.org/@noble/ciphers/-/ciphers-2.3.0.tgz     | sha256sum
curl -sL https://registry.npmjs.org/@noble/hashes/-/hashes-2.0.1.tgz       | sha256sum
```

The vendored files must be byte-identical to `package/index.js` and to
`package/{chacha,_arx,utils,_poly1305}.js` inside those tarballs.

Correctness is not taken on trust either: `tools/nostr-crypto.test.mjs` runs the
official BIP-340 test vectors and the RFC 8439 ChaCha20 vector against this exact
copy, so an accidental truncation or a bad re-vendor fails `scripts/check`.

## Upgrading

Re-download, replace the files, update the version and digest above, and run
`scripts/check`. Never edit a file in place.

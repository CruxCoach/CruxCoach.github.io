# cruxcoach-pages

Source for **https://cruxcoach.org** — the public landing page for the
CruxCoach open-source Android Kilter Board app.

Published via Codeberg Pages. Repo contents are served directly: edit
`index.html`, push, page is live within minutes.

## Layout

```
cruxcoach-pages/
├── index.html         single-file landing page (HTML + embedded CSS, no JS, no build)
├── .domains           Codeberg Pages custom-domain config
├── assets/            screenshots, logos, og-image (added later)
└── README.md          this file
```

## Editing

- One file, one language (English) for now. German `/de/index.html` planned.
- No build step. Edit `index.html`, commit, push.
- Test locally: `python3 -m http.server` in repo root, open <http://localhost:8000>.

## Style guidelines

- No external dependencies (no CDN-hosted CSS/fonts/JS). System font stack only.
- No analytics, no cookies, no third-party embeds.
- Prefer plain semantic HTML over div soup.
- Light + dark mode via `prefers-color-scheme` — no JS toggle.
- Accessibility: every link has discernible text; phone-mockup is `aria-hidden="true"`.
- **JS exception**: `404.html` runs inline JavaScript on `/c/<naddr>` paths
  to fetch climb metadata from public Nostr relays (`relay.damus.io`,
  `nos.lol`, `relay.primal.net`) and render an install/landing view.
  No external scripts, no analytics — just WebSocket calls. The rest of
  the site stays JS-free.

## Deployment

Codeberg Pages serves the default branch of this repo at:
- `https://CruxCoach.codeberg.page/cruxcoach-pages/` (built-in URL)
- `https://cruxcoach.org/` (custom domain, configured via `.domains` + DNS)

DNS at Njalla:
- A `cruxcoach.org` → `217.197.91.145`
- AAAA `cruxcoach.org` → `2a02:6ea0:c813::145`
- (TLS handled automatically by Codeberg via Let's Encrypt)

## Roadmap

### Done
- [x] Real logo (inline SVG from `assets/logo.svg`)
- [x] Real hero screenshot replacing CSS phone-mockup
- [x] Screenshot gallery with lazy-loading
- [x] Favicon + apple-touch-icon
- [x] OG / Twitter Card meta tags (using app icon)
- [x] German variant at `/de/index.html` with `hreflang` alternates
- [x] Dark-mode-only (color-scheme=dark in meta)
- [x] PNG metadata stripped (tIME, tEXt date:create/modify)
- [x] `/imprint.html` and `/de/imprint.html`
- [x] `/privacy.html` and `/de/privacy.html`
- [x] `/support.html` and `/de/support.html` with Lightning QR
- [x] `/404.html` with brand-consistent error page
- [x] `/.well-known/security.txt` (RFC 9116)
- [x] `sitemap.xml` (includes hreflang alternates)
- [x] `robots.txt` (sitemap reference, noindex on legal pages)
- [x] `humans.txt` (FOSS-tradition colophon)
- [x] JSON-LD `SoftwareApplication` schema in `<head>` (both languages)
- [x] Real Nostr `npub` link via primal.net
- [x] OG image SVG asset (`assets/og-image.svg`, 1200×630, not yet wired to og:image — needs PNG export)

### Open
- [ ] **Image optimization** — gallery screenshots total ~700 KB. Resize to max 800 px wide, convert to WebP. Hero is 184 KB which is OK; gallery is lazy-loaded but heavy on mobile
- [ ] **Render og-image.svg → og-image.png** (1200×630) and switch og:image / twitter:image meta-tags to it. Needs a tool (Inkscape, librsvg, or online converter)
- [ ] **`/press.html`** press kit with high-res logo, screenshots, brief & long descriptions, story angles
- [ ] **`/faq.html`** with anticipated normy questions
- [ ] **Update Mastodon link** once `@cruxcoach@mastodon.social` is verified
- [ ] **Once F-Droid / IzzyOnDroid listings land**, update install cards from "soon" to actual links
- [ ] **Set Codeberg-Repo `Website` field** (manual UI step) to `https://cruxcoach.org`

## Image-optimization notes

For when tools are available:

```bash
# Resize + WebP (need cwebp + ImageMagick)
for f in assets/screenshots/*.png; do
  convert "$f" -resize 800x "${f%.png}.tmp.png" \
    && cwebp -q 85 "${f%.png}.tmp.png" -o "${f%.png}.webp" \
    && rm "${f%.png}.tmp.png"
done

# Or with optipng (no resize, no WebP, just lossless squeeze)
optipng -o5 assets/screenshots/*.png
```

## License

Site content (this repo): CC-BY-4.0.
Underlying CruxCoach app: GPL-3.0, separate repo at codeberg.org/CruxCoach/CruxCoach.

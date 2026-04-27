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

## Deployment

Codeberg Pages serves the default branch of this repo at:
- `https://CruxCoach.codeberg.page/cruxcoach-pages/` (built-in URL)
- `https://cruxcoach.org/` (custom domain, configured via `.domains` + DNS)

DNS at Njalla:
- A `cruxcoach.org` → `217.197.91.145`
- AAAA `cruxcoach.org` → `2a02:6ea0:c813::145`
- (TLS handled automatically by Codeberg via Let's Encrypt)

## Roadmap

- [ ] Replace phone-mockup placeholder with a real screenshot
- [ ] Add `/de/index.html` German version
- [ ] Add `/imprint.html` (minimal — Codeberg is the operator)
- [ ] Add `/privacy.html` (one-page, no-data-collected statement)
- [ ] Open Graph image for social-link previews
- [ ] Replace Nostr placeholder with real npub once handle is claimed
- [ ] Update Mastodon link once `@cruxcoach@fosstodon.org` is claimed
- [ ] Once F-Droid / IzzyOnDroid listings land, update install cards from "soon" to actual links

## License

Site content (this repo): CC-BY-4.0.
Underlying CruxCoach app: GPL-3.0, separate repo at codeberg.org/CruxCoach/CruxCoach.

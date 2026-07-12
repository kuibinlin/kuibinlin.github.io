# Cover Studio CLI

Generate a 1200×630 blog cover image from a post's front matter, by headlessly
rendering the same page used for the interactive studio
([`webapps/cover-studio/`](../../webapps/cover-studio/index.html), live at
`/cover-studio/`). One design, two ways to drive it — click-and-tune in the
browser, or scripted from the terminal.

## Setup (once per machine)

```bash
cd tools/cover
npm install      # installs the puppeteer package
npm run setup    # downloads the version-locked Chrome into ~/.cache/puppeteer
```

`npm run setup` is required because Puppeteer's automatic browser download (its
`postinstall`) is skipped in this environment. It fetches the exact Chrome build
pinned to the installed `puppeteer` version, so every machine runs an identical,
reproducible browser. The download lives outside the repo (`~/.cache/puppeteer`)
and is git-ignored by default.

## Usage

Run from the repo root:

```bash
node tools/cover/generate.mjs \
  --post brevo \
  --title "Add a Newsletter to Your Blog" \
  --label Jekyll \
  --bg "Apple Blue"
```

This reads the matching post's front matter and writes the cover to
`{media_subpath}/{image}` — e.g.
`assets/media/2026/how-to-add-…-brevo/subscribe.png`.

### What comes from the post vs. the CLI

| Cover element | Source |
| --- | --- |
| Output directory | `media_subpath` (created if missing) |
| Output filename **+ format** | `image` (`.png` → PNG, `.webp` → WebP, `.jpg` → JPEG) |
| Subtitle | the post `title` |
| Big title | `--title` (you type it) |
| Label + auto icon | `--label` (you type it) |
| Background | `--bg` |

### Flags

| Flag | Required | Description |
| --- | --- | --- |
| `--post <name>` | ✅ | Post name, fragment, or path. Searched under `_posts/` (matches the filename or the slug after the `YYYY-MM-DD-` prefix). Ambiguous matches are listed so you can narrow down. |
| `--title "..."` | ✅ | The big headline on the cover. |
| `--label <text>` | ✅ | Small label; also auto-loads its [Devicon](https://devicon.dev) icon (e.g. `Jekyll`, `Docker`, `Python`). |
| `--bg <name\|hex>` | | `Google Blue/Red/Green/Yellow`, `Apple Orange/Blue`, or any `#hex`. Default: Google Blue. |
| `--subtitle "..."` | | Override the subtitle (default is the post title). |
| `--path <dir>` | | Override the output directory (default is the post `media_subpath`). |
| `--name <file>` | | Override the output filename incl. extension (default is the post `image`). |
| `--dry-run` | | Print what would be written, without launching the browser. |
| `-h`, `--help` | | Show help. |

### Notes

- **Network is required at generate time** — Google Fonts (Lato/Lora) and the
  Devicon icon load from CDNs, exactly like the browser studio.
- The image is produced by the studio's own `html2canvas` + `toDataURL` — the
  same code path as the page's Download button — so the CLI output matches what
  you'd get from the browser.
- This directory is excluded from the Jekyll build (`tools` in `_config.yml`),
  so it never ships with the site.

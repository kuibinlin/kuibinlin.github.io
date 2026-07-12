#!/usr/bin/env node
/*
 * Cover Studio CLI
 * ----------------
 * Render a 1200x630 blog cover image by driving the SAME page used for the
 * interactive studio (webapps/cover-studio/index.html) in headless Chromium.
 *
 * Reads from the target post's front matter:
 *   title         -> cover subtitle
 *   media_subpath -> output directory (created if missing)
 *   image         -> output filename + format (.png / .webp / .jpg)
 *
 * You supply the look on the CLI: --title (headline), --label (+ auto icon), --bg.
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // <repo>/tools/cover
const REPO_ROOT = path.resolve(HERE, '..', '..');              // <repo>
const STUDIO_HTML = path.join(REPO_ROOT, 'webapps', 'cover-studio', 'index.html');
const POSTS_DIR = path.join(REPO_ROOT, '_posts');

/* Named background themes -> hex. Matches THEMES in the studio page. */
const THEME_HEX = {
  'google blue':   '#4285F4',
  'google red':    '#EA4335',
  'google green':  '#34A853',
  'google yellow': '#FBBC05',
  'apple orange':  '#f77314',
  'apple blue':    '#0071e3',
};

/* Output extension -> Puppeteer screenshot type. */
const FORMATS = { png: 'png', webp: 'webp', jpg: 'jpeg', jpeg: 'jpeg' };

function fail(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));

async function main() {
  const opts = readFlags();
  if (opts.help) return printHelp();

  if (!opts.post)  fail('--post is required (post name, fragment, or path).');
  if (!opts.title) fail('--title is required (the big headline on the cover).');
  if (!opts.label) fail('--label is required (the small label + auto icon).');

  const postFile = await resolvePost(opts.post);
  const fm = parseFrontMatter(await readFile(postFile, 'utf8'));
  if (!fm.title) fail('Post "' + rel(postFile) + '" has no "title" in its front matter.');

  const subpath = opts.path || stripLeadingSlash(fm.media_subpath || '');
  if (!subpath) fail('No output directory: pass --path, or add media_subpath to the post front matter.');
  const outDir = path.resolve(REPO_ROOT, subpath);

  const rawName = opts.name || fm.image;
  if (!rawName) fail('No output filename: pass --name, or add image to the post front matter.');
  const { filename, format } = resolveName(rawName, fm.image);
  const outPath = path.join(outDir, filename);

  const cfg = {
    label: opts.label,
    title: opts.title,
    subtitle: opts.subtitle != null ? opts.subtitle : fm.title,
    bg: resolveBg(opts.bg),
  };

  console.log('Post:       ' + rel(postFile));
  console.log('Label:      ' + cfg.label);
  console.log('Title:      ' + cfg.title);
  console.log('Subtitle:   ' + cfg.subtitle);
  console.log('Background:  ' + cfg.bg);
  console.log('Output:     ' + rel(outPath) + '  (' + format.toUpperCase() + ')');

  if (opts['dry-run']) {
    console.log('\nDry run — nothing written.');
    return;
  }

  await mkdir(outDir, { recursive: true });
  await renderCover(cfg, outPath, format);
  console.log('\n✔ Wrote ' + rel(outPath));
}

function readFlags() {
  try {
    return parseArgs({
      options: {
        post:      { type: 'string' },
        title:     { type: 'string' },
        label:     { type: 'string' },
        bg:        { type: 'string' },
        subtitle:  { type: 'string' },
        path:      { type: 'string' },
        name:      { type: 'string' },
        'dry-run': { type: 'boolean' },
        help:      { type: 'boolean', short: 'h' },
      },
    }).values;
  } catch (e) {
    fail(e.message);
  }
}

function rel(p) { return path.relative(REPO_ROOT, p) || p; }
function stripLeadingSlash(s) { return String(s).replace(/^\/+/, ''); }

function resolveBg(v) {
  if (!v) return THEME_HEX['google blue'];
  const key = v.trim().toLowerCase();
  if (THEME_HEX[key]) return THEME_HEX[key];
  if (/^#([0-9a-f]{3}){1,2}$/i.test(v.trim())) return v.trim();
  fail('--bg "' + v + '" is not a theme name (' + Object.keys(THEME_HEX).join(', ') + ') or a #hex color.');
}

function resolveName(name, postImage) {
  let base = path.basename(String(name).trim());
  let ext = path.extname(base).slice(1).toLowerCase();
  if (!ext) {
    ext = (postImage ? path.extname(postImage).slice(1).toLowerCase() : '') || 'webp';
    base = base + '.' + ext;
  }
  const format = FORMATS[ext];
  if (!format) fail('Unsupported output extension ".' + ext + '". Use .png, .webp, or .jpg.');
  return { filename: base, format };
}

async function resolvePost(value) {
  /* 1. An actual file path (with or without .md). */
  const asPath = path.resolve(REPO_ROOT, value);
  if (existsSync(asPath) && asPath.endsWith('.md')) return asPath;
  if (existsSync(asPath + '.md')) return asPath + '.md';

  /* 2. A name or fragment, searched under _posts/. */
  const q = String(value).trim().replace(/\.md$/i, '');
  const files = await listMarkdown(POSTS_DIR);
  const cand = files.map((f) => {
    const b = path.basename(f, '.md');
    return { f, base: b, slug: b.replace(/^\d{4}-\d{2}-\d{2}-/, '') };
  });

  let hits = cand.filter((c) => c.base === q || c.slug === q);
  if (hits.length === 0) hits = cand.filter((c) => c.base.includes(q) || c.slug.includes(q));

  if (hits.length === 1) return hits[0].f;
  if (hits.length === 0) fail('No post matches "' + value + '" under _posts/.');

  console.error('✖ "' + value + '" matches ' + hits.length + ' posts — be more specific:');
  hits.slice(0, 25).forEach((h) => console.error('    ' + rel(h.f)));
  process.exit(1);
}

async function listMarkdown(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

/* Minimal YAML front-matter reader for the flat scalar keys we need. */
function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[mm[1]] = v;
  }
  return fm;
}

/* Load the studio page and strip Jekyll front matter + {% raw %} wrappers so
 * headless Chromium sees plain HTML. */
async function loadStudioHtml() {
  if (!existsSync(STUDIO_HTML)) fail('Studio page not found at ' + rel(STUDIO_HTML));
  let html = await readFile(STUDIO_HTML, 'utf8');
  return html
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/\{%-?\s*raw\s*-?%\}/g, '')
    .replace(/\{%-?\s*endraw\s*-?%\}/g, '');
}

/* Launch the version-locked Chromium that Puppeteer manages. If it has not been
 * downloaded yet, point the user at the one-time setup step (no silent fallback
 * to a system browser — the managed build must be identical on every machine). */
async function launchBrowser() {
  try {
    return await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  } catch (e) {
    if (/could not find|was not found|executable|revision/i.test(e.message || '')) {
      fail('Chromium is not installed yet. Run once:  cd tools/cover && npm run setup');
    }
    throw e;
  }
}

async function renderCover(cfg, outPath, format) {
  const html = await loadStudioHtml();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';

    /* Drive the page's own controls, then rasterize with the page's OWN
     * html2canvas + toDataURL — the exact path the studio's Download button uses,
     * so the CLI output matches the browser output. */
    const dataUrl = await page.evaluate(async (c) => {
      document.getElementById('title').value = c.title;
      document.getElementById('subtitle').value = c.subtitle;
      document.getElementById('label').value = c.label;
      setSolid(c.bg);                 // background + accent + text color + render
      await loadAutoIcon(c.label);    // fetch the label's icon (resolves even on failure)
      await document.fonts.ready;      // ensure Lato/Lora webfonts are in
      render();
      document.getElementById('scaler').style.transform = 'scale(1)';  // capture at full size
      const canvas = await html2canvas(document.getElementById('card'), {
        scale: 1, backgroundColor: null, useCORS: true, width: 1200, height: 630,
      });
      return canvas.toDataURL(c.mime, c.quality);
    }, { ...cfg, mime, quality: 0.92 });

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await writeFile(outPath, Buffer.from(base64, 'base64'));
  } finally {
    await browser.close();
  }
}

function printHelp() {
  console.log([
    'Cover Studio — generate a 1200x630 blog cover from a post\'s front matter.',
    '',
    'Usage:',
    '  node generate.mjs --post <name> --title "Headline" --label <tech> [--bg <color>]',
    '',
    'Required:',
    '  --post <name>     Post name, fragment, or path (searched under _posts/)',
    '  --title "..."     Big headline on the cover (you type this)',
    '  --label <text>    Small label + auto Devicon icon (you type this)',
    '',
    'Optional:',
    '  --bg <name|hex>   Google Blue/Red/Green/Yellow, Apple Orange/Blue, or #hex (default Google Blue)',
    '  --subtitle "..."  Override subtitle (default = the post title)',
    '  --path <dir>      Override output dir (default = post media_subpath)',
    '  --name <file>     Override output filename incl. extension (default = post image)',
    '  --dry-run         Print what would be written, without launching the browser',
    '  -h, --help        Show this help',
  ].join('\n'));
}

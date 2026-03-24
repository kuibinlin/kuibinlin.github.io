---
layout: post
title: Flashcard App with GitHub OAuth and Cloudflare Workers
description: How I built a full-stack learning platform with user auth, leaderboards, and a real database on top of a Jekyll static site, using Cloudflare Workers and D1 for free.
date: 2026-03-24 19:00:00 +0800
media_subpath: /assets/media/2026/flashcard-app-with-github-oauth-and-cloudflare-workers
image: github_cloudflare.png
published: true
categories: [website, project]
tags:
  [
    cloudflare-workers,
    cloudflare-d1,
    jekyll,
    javascript,
    tutorial,
    authentication,
  ]
---

## Why I Built This

Last year when I was still a Chinese teacher, I vibe coded a [Flashcard app](/flashcard/) for my students to learn Chinese vocabulary. It still works, and I still see a few visitors on that page from time to time. The problem is all the card data was created by me, stored in a Google Sheet, and manually loaded in. It worked fine for a small and narrow group of users. They could technically load their own flashcards via Google Sheet, but it was a bit troublesome and not that easy to set up. There was no proper way for others to just create and share their own decks.

Then I started thinking about redesigning it. With Claude Code getting more capable, I wanted to see how far I could push it to help me build something real. At the same time, I had been looking at the GitHub Developer Programme requirements, and one of them is to actually use the GitHub API in your app. That gave me the push to finally build something more complete.

A few other motivations stacked up on top of that. A friend of mine, Samuel Cheong, has been studying Chinese terms for machine learning and AI. He was carrying around a printed word list. I thought, if I can get this app working, he can just open it on his phone instead. That felt like a good real-world test.

I also wanted to try Cloudflare Workers and D1 on a real project. I had heard good things about their free tier but never had a proper reason to use them until now. And I did not want to spend money on a backend just for a side project.

So the goals were: let anyone contribute decks, add a quiz challenge mode with leaderboards so friends can compete, use the GitHub API for auth, and keep the entire backend cost at zero.

I discussed the idea and the plan with Claude Code first, went through the architecture, the features, and the trade-offs. Once everything looked good, I let it implement. This post walks through how it came together.

## Architecture Overview

```
Browser (Jekyll/GitHub Pages)
         │
         │  HTTPS API calls
         ▼
Cloudflare Worker (API backend)
         │
         ├── Cloudflare D1 (SQLite database)
         └── Cloudflare KV  (session storage)
```

The Jekyll site serves a **single-page app** (SPA) as a static HTML file at `/mydeck/`. It has no server-side rendering — everything is plain HTML, CSS, and vanilla JavaScript. The Worker handles all data and auth logic as a REST API.

## Why This Stack

The goal was zero hosting cost, no VPS, no server to maintain.

| Layer               | Service            | Cost                     |
| ------------------- | ------------------ | ------------------------ |
| Frontend            | GitHub Pages       | Free                     |
| API backend         | Cloudflare Workers | Free (100k req/day)      |
| Database            | Cloudflare D1      | Free (5GB, 5M reads/day) |
| Sessions            | Cloudflare KV      | Free (100k reads/day)    |
| Email (magic links) | Resend             | Free (3k emails/month)   |

Everything runs on free tiers. The only cost is the domain.

## The Frontend: A Self-Contained SPA

The entire app lives in one file: `webapps/mydeck/index.html`. Because it uses `layout: null` in the Jekyll front matter, Jekyll outputs it as pure HTML with no theme chrome.

```yaml
---
title: MyDeck
layout: null
permalink: /mydeck/
---
```

All views (dashboard, flashcard list, challenge player, leaderboard, etc.) are `<div>` elements toggled with a simple `showView()` function:

```javascript
function showView(viewId) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${viewId}`).classList.add("active");
  window.scrollTo(0, 0);
}
```

Navigation is handled client-side — no page reloads:

```javascript
function navigate(viewId, data) {
  if (!currentUser && viewId !== "auth") {
    showView("auth");
    return;
  }
  switch (viewId) {
    case "dashboard":
      showView("dashboard");
      loadDashboard();
      break;
    case "fc-list":
      showView("fc-list");
      loadFlashcardDecks();
      break;
    case "ch-play":
      showView("ch-play");
      loadChPlay(data);
      break;
    // ...
  }
}
```

API calls go through a small helper that attaches the Bearer token from `localStorage`:

```javascript
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
```

## The Backend: Cloudflare Worker

The Worker (`worker/src/index.js`) is a single JavaScript file that handles all routes. Cloudflare Workers run at the edge — no cold start, no server to manage.

The Worker is set up with two bindings in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mydeck-db"

[[kv_namespaces]]
binding = "SESSIONS"
id = "..."
```

`env.DB` gives you a D1 SQLite database. `env.SESSIONS` gives you a KV store.

Route dispatch is straightforward:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") return corsHeaders();

    if (path === "/auth/login" && method === "POST")
      return handleLogin(request, env);
    if (path === "/auth/verify" && method === "GET")
      return handleVerify(request, env);
    if (path === "/api/flashcard-decks" && method === "GET")
      return handleListFcDecks(request, env);
    // ...
  },
};
```

## Authentication

There are two auth methods: **magic link email** and **GitHub OAuth**. Both produce a session token stored in KV.

### Magic Link

1. User enters their email
2. Worker generates a random token, stores `verify:${token} → email` in KV with 15-minute TTL
3. Resend sends an email with the link: `https://linsnotes.com/mydeck/#verify=TOKEN`
4. User clicks → frontend extracts the token from the URL hash and calls `/auth/verify`
5. Worker looks up the token in KV, finds or creates the user in D1, returns a 30-day session token

For new users, the frontend first sends just the email. If the account doesn't exist, the Worker returns `{ needsUsername: true }`. The frontend then shows a username field, and the second request includes the chosen username. This way, existing users are never prompted for a username again.

```javascript
// Two-step login flow
const data = await api("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email }),
});

if (data.needsUsername) {
  // Show username input, then resubmit with username
}
```

### GitHub OAuth

```
Browser → /auth/github → GitHub login page
                              │
                    user approves
                              │
                              ▼
GitHub → /auth/github/callback (Worker)
    1. Exchange code for access token (GitHub API)
    2. Fetch user profile (api.github.com/user)
    3. Find or create user in D1
    4. Create session in KV
    5. Redirect to /mydeck/#token=SESSION_TOKEN
```

The Worker calls three GitHub API endpoints:

- `github.com/login/oauth/access_token` — exchange auth code
- `api.github.com/user` — get profile (name, avatar)
- `api.github.com/user/emails` — get email if not public

This GitHub integration is what qualifies the app for the **GitHub Developer Program**.

## Database Schema

D1 uses SQLite. The main tables:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  github_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE flashcard_decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE flashcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER REFERENCES flashcard_decks(id),
  front TEXT NOT NULL,
  meaning TEXT NOT NULL,
  note TEXT
);

CREATE TABLE challenge_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER REFERENCES challenge_decks(id),
  version_number INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  challenge_version_id INTEGER REFERENCES challenge_versions(id),
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  played_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Challenge Versioning

A published challenge creates a new **version**. Scores are attached to a version, not the deck. This means:

- The creator can update the deck (add/fix questions)
- Publishing creates v2, with a fresh leaderboard
- v1 scores are preserved — fair because everyone played the same questions

## CSV Import

Decks can be bulk-imported via CSV. The template is downloadable with usage notes baked in as `#` comment lines:

```
# How to use: Replace the example row below with your own data.
# Columns: front | meaning | note (optional)
# Lines starting with # are ignored.
front,meaning,note
"car","a vehicle with four wheels",""
```

The parser strips comment lines, handles quoted fields (including multi-language characters), and adds a UTF-8 BOM to the download so Excel and Numbers render Chinese/Japanese correctly:

```javascript
function downloadCSV(filename, content) {
  const blob = new Blob(["\uFEFF" + content], {
    type: "text/csv;charset=utf-8;",
  });
  // ...
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM on upload
  text = text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // character-by-character parser that handles quoted commas...
}
```

## Ownership and Access Control

Every write operation checks that the authenticated user owns the resource:

```javascript
// Only the deck creator can edit it
const deck = await env.DB.prepare("SELECT * FROM flashcard_decks WHERE id = ?")
  .bind(deckId)
  .first();

if (!deck || deck.created_by !== user.id) {
  return json({ error: "Not authorised" }, 403, request);
}
```

Anyone can read and play decks. Only the creator can edit or add cards.

## Dark / Light Mode

The app supports both system preference and a manual toggle. The theme is stored in `localStorage`:

```javascript
function initTheme() {
  const saved = localStorage.getItem("md_theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
}

function toggleTheme() {
  const isDark =
    document.documentElement.getAttribute("data-theme") === "dark" ||
    (!localStorage.getItem("md_theme") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = isDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("md_theme", next);
}
```

CSS variables switch based on `[data-theme]` — no class toggling, no JavaScript in the style layer:

```css
:root,
[data-theme="light"] {
  --bg: #f5f5f7;
  --card: #ffffff;
  --text: #1d1d1f;
  --msg-success-bg: #d4edda;
  --msg-success-text: #155724;
}
[data-theme="dark"] {
  --bg: #1c1c1e;
  --card: #2c2c2e;
  --text: #f5f5f7;
  --msg-success-bg: rgba(52, 199, 89, 0.15);
  --msg-success-text: #6ee7a0;
}
```

## Deployment

```bash
# Deploy the Worker (run from /worker)
npm run deploy   # runs: wrangler deploy

# Initialise the database
npm run db:init  # runs: wrangler d1 execute mydeck-db --file=schema.sql
```

The Jekyll site deploys automatically via GitHub Actions on every `git push`.

Two separate deploy steps for two separate platforms — that's the tradeoff of this architecture.

---

## What I Learned

- **D1 is surprisingly capable** for a free SQLite-as-a-service. Joins, indexes, and batch operations all work as expected.
- **Vanilla JS is enough** for a focused SPA. No framework needed when you control the entire page.
- **CSV + UTF-8 BOM** is the right choice over Excel files when you need multi-language import without extra dependencies.
- **Leaderboard versioning** is a small schema decision that has a big UX impact. Players feel the competition is fair because everyone played the same version of the questions.

## Final Thoughts

Claude Code helped a lot throughout this build. That said, it used more tokens than I expected. I hit the daily limit a couple of times and ended up topping up to push through and get it done. I am on the Pro plan, so if you are planning something similar, budget accordingly if you want to move fast.

On the backend cost side though, I spent nothing. Cloudflare Workers, D1, and KV are all free at this scale. Resend is free for the first 3,000 emails a month. The only cost is the domain.

If you have been sitting on the idea of adding a backend to a static site but do not want to deal with servers, this stack is worth trying. It is surprisingly capable for free.

MyDeck is live at [linsnotes.com/mydeck/](/mydeck/). The source is in the same repo as this blog.

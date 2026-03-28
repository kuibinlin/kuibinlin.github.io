---
layout: post
title: Flashcard App with GitHub OAuth and Cloudflare Workers
description: How I built a full-stack learning platform with user auth, leaderboards, and a real database on top of a Jekyll static site, using Cloudflare Workers and D1 for free.
date: 2026-03-24 19:00:00 +0800
media_subpath: /assets/media/2026/flashcard-app-with-github-oauth-and-cloudflare-workers
image: github_cloudflare.png
published: false
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

I built a flashcard app. Again.

Last year, I vibe-coded a flashcard app for learning Chinese vocabulary.

I was a Chinese teacher, and I kept seeing my students struggle with new vocabulary. A big part of that was simply not reviewing words enough. There weren’t many good flashcard resources that matched what they were learning, and most existing apps weren’t really designed for Chinese. On top of that, creating flashcards takes time, and it’s usually not a student’s top priority.

But I knew spaced repetition works. It’s one of the most effective ways to actually remember things, not just cram and forget. Flashcards aren’t the method itself, but they’re probably the simplest way to make spaced repetition actually usable in real life.

So instead of expecting students to make their own flashcards, I built something they could just open and use.

It was a simple web app. Flip, next, previous, shuffle. No backend, just simple HTML code. But it turned out to be quite useful for my students. They actually used it.

Even now, it’s still running, and I still see the occasional bump in visitors.

It worked, but how the flashcards were managed wasn’t ideal. Most of the data was prepared by me alone, stored in a Google Sheet, and then loaded into the web UI through a shared link.

I had designed it this way so teachers or students could create their own flashcards using just Google Sheets and plug them in. It sounded flexible. In practice, not so much.

Every time someone, even me, wanted to create a deck, we had to set the sheet permissions to “anyone can view” so the app could access it. Then users either needed the direct link or had to add it to a master list, which was just another Google Sheet that only I could edit. Not intuitive.

I ended up managing everything, checking accuracy, and maintaining the decks. Not sustainable.

So recently, I started thinking about building another one. Not exactly the flashiest idea, considering the world has moved on to AI-powered apps and agentic workflows.

But I still had my reasons.

With AI coding assistants getting better, especially tools like Claude Code, I wanted to see how far I could push it. Especially since I’m not from a software or CS background, it felt like a good experiment and a way to learn along the way.

A few other motivations stacked on top of that.

First, I had been wanting to join the GitHub Developer Program and explore what it offers. That made me think about how I could actually integrate the GitHub API into my existing site or a side project.

Second, my friend Samuel Cheong. We’re both AIAP apprentices, and he sits right next to me. At some point, he started learning Chinese terms for machine learning and AI, things like “Convolutional Neural Network is 卷积神经网络.”

He would carry around a printed list of terms, and sometimes when we were on the train home, he’d just take it out and revise like it was light reading.

Even as a Chinese teacher, I realised I didn’t actually know many of these technical terms in Chinese. I learned AI and ML entirely in English. And interestingly, quite a few other AIAP apprentices also found these English-Chinese term lists fun.

So I thought, if I rebuild the app properly, Samuel could just open it on his phone instead of carrying around his trusty piece of paper. That felt like a fun project.

Third, I wanted to try out Cloudflare Workers and D1 in a real project. I had heard about their free tier for a while but never had a good excuse to use them. Also, I wasn’t about to start paying for backend infrastructure for a side project.

So the goals became:

- Add a proper database so it’s no longer just me managing everything

- Let anyone create, edit, and share their own decks

- Support importing decks via a CSV template for convenience

- Include quiz challenges with leaderboards, so friends can compete (because nothing motivates like a bit of friendly rivalry)

- Handle user identity, probably via email or GitHub authentication

- Integrate everything into my existing static site

- Keep backend costs at exactly zero dollars, ideally forever

I discussed the idea and plan with Claude Code first. We went through the architecture, features, and trade-offs.

Once everything looked solid, I let it take a shot at implementing it.

What follows is how it all came together.

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

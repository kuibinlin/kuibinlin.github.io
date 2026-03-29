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

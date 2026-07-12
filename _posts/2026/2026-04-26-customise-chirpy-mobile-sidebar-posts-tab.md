---
layout: post
title: Customize Chirpy Mobile View to Show Full Sidebar Menu Including a Posts Tab
description: A step by step guide to replacing Chirpy's mobile topbar with a full screen sidebar menu and adding a POSTS toggle, using CSS and JavaScript only.
date: 2026-04-26 12:00:00 +0800
published: true
categories: jekyll
toc: true
media_subpath: /assets/media/2026/customise-chirpy-mobile-view
image: chirpy-mobile.webp
tags: [chirpy, mobile]
---


On mobile, Chirpy's home page stacks three things vertically. A topbar with a hamburger sits on top, the latest posts list takes the middle, and the sidebar slides in from the left when you tap the hamburger. It works, but on a small screen the home page reads as a feed. The navigation, About, Archives, Categories, Tags, hides behind a hamburger tap.

I wanted the opposite. On the home page on mobile, the first thing visitors see should be a full screen menu with the avatar, navigation tabs, and social icons. Posts are one tap away through a dedicated **POSTS** tab. Everywhere else, on post pages, archives, categories, Chirpy's default mobile behaviour stays untouched.

End result:

| State | What you see |
| ----- | ------------ |
| Mobile home (`/`) | Full screen sidebar menu, no hamburger needed |
| Tap **POSTS** in the sidebar | Chirpy's normal posts list view |
| Tap **HOME** anywhere | Back to the menu view |
| Desktop home | Unchanged, sidebar on left and posts on right |
| Mobile non home (post pages and so on) | Unchanged, Chirpy's default behaviour |

## The approach in one sentence

Hide `#main-wrapper` on mobile home so only `#sidebar` remains, expand the sidebar to full width, then inject a **POSTS** tab into the sidebar nav list using JavaScript that toggles a `<html>` class to swap between menu view and posts view.

Three pieces:

1. **CSS** that hides the main content and stretches the sidebar, scoped to mobile width AND home page AND not in posts mode.
2. **A DOMContentLoaded JavaScript block** that injects the POSTS list item and wires the click handler.
3. **A synchronous head script** that pre applies the posts mode class when arriving at `/#posts` from another tab, so the menu view does not flash before the click handler runs.

## The CSS

Two custom signals make this work:

- `:has(#post-list)` is a CSS selector that matches when an element with id `post-list` exists somewhere inside the parent. Chirpy's home layout is the only layout that renders this id. Other home style pages (archives, categories, tags) use different ids, so this scopes the override to `/` only without touching any markup.
- `html.posts-mode` is a class set on `<html>` when the user taps POSTS. The CSS rule includes `html:not(.posts-mode)`, so adding the class disengages the override and Chirpy's default mobile layout returns.

Append this block to `assets/css/jekyll-theme-chirpy.scss`:

```scss
/* Hide the injected POSTS tab on desktop. Desktop home already
   shows posts on the right, so this would be redundant there. */
@media (min-width: 850px) {
  .nav-item.posts-toggle {
    display: none;
  }
}

/* Suppress Chirpy's slide transition on the sidebar during the
   menu vs posts toggle. Without this, the sidebar visibly slides
   off screen and reveals the posts list mid animation. */
.no-sidebar-transition #sidebar {
  transition: none !important;
  -webkit-transition: none !important;
}

@media (max-width: 849px) {
  html:not(.posts-mode) body:has(#post-list) {
    min-height: 100vh; /* iOS Safari safety net */

    #main-wrapper {
      /* !important is required: Bootstrap's d-flex utility class
         is display: flex !important, so our rule needs the same
         weight to win. */
      display: none !important;
    }

    #sidebar {
      width: 100%;
      transform: none;
      -webkit-transform: none;
      border-right: none;

      /* Bootstrap's align-items-end right edges children. Centre
         them instead so the now full width sidebar feels balanced. */
      align-items: center !important;

      .profile-wrapper {
        padding-left: 0;
        padding-right: 0;
        text-align: center;
      }

      #avatar,
      .site-title {
        margin-left: auto;
        margin-right: auto;
      }

      .sidebar-bottom {
        justify-content: center;
      }
    }
  }
}
```

## The JavaScript that injects the POSTS tab

This block lives in `_includes/metadata-hook.html` so it runs on every page. If your project does not yet have a metadata hook include, create the file and ensure your layout pulls it in (Chirpy's default layout already includes it when present).

```javascript
document.addEventListener('DOMContentLoaded', function () {
  var navList = document.querySelector('#sidebar nav ul.nav');
  var homeItem = navList && navList.querySelector('.nav-item');
  if (!homeItem) return;

  /* :has(#post-list) is true only on the home layout. Same signal
     the CSS uses to scope the menu view override. */
  var isHome = !!document.getElementById('post-list');
  var homeUrl = '{{ "/" | relative_url }}';
  var html = document.documentElement;

  /* Build the <li> and insert right after HOME */
  var li = document.createElement('li');
  li.className = 'nav-item posts-toggle';
  var a = document.createElement('a');
  a.className = 'nav-link';
  a.href = isHome ? '#' : homeUrl + '#posts';
  a.setAttribute('role', 'button');
  a.innerHTML = '<i class="fa-fw fas fa-newspaper"></i><span>POSTS</span>';
  li.appendChild(a);
  homeItem.insertAdjacentElement('afterend', li);

  /* On non home pages, the link's href does the work. The browser
     navigates to /#posts and the head script (below) lands the
     home page directly in posts view. */
  if (!isHome) return;

  /* On the home page, intercept the click to toggle without navigating. */
  if (window.location.hash === '#posts') {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  a.addEventListener('click', function (e) {
    e.preventDefault();

    /* Close Chirpy's hamburger overlay if the user opened it.
       This keeps Chirpy's internal state in sync with our toggle. */
    var trigger = document.getElementById('sidebar-trigger');
    if (trigger && document.body.hasAttribute('sidebar-display')) {
      trigger.click();
    }

    if (html.classList.contains('posts-mode')) return;

    /* Suppress the sidebar slide transition for two animation
       frames so the swap snaps instead of revealing posts mid slide. */
    document.body.classList.add('no-sidebar-transition');
    html.classList.add('posts-mode');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.body.classList.remove('no-sidebar-transition');
      });
    });
  });

  /* Defensive cleanup: prevent a stuck posts mode state if the
     user resizes or rotates into desktop width while toggled on. */
  window.addEventListener('resize', function () {
    if (window.innerWidth > 849 && html.classList.contains('posts-mode')) {
      html.classList.remove('posts-mode');
    }
  });
});
```

## The synchronous head script that prevents a flash

When a visitor on `/about/` taps POSTS, they navigate to `/#posts`. Without anything else, the home page would render the full screen menu first (the CSS engages because `html.posts-mode` is not set yet). Then `DOMContentLoaded` fires, the handler sets the class, and the menu vanishes. The user sees a brief flash of the menu before it disappears.

The fix is a tiny **synchronous** script in the `<head>` that adds `posts-mode` *before* `<body>` parses, so the CSS short circuits on the very first paint.

```html
<script>
  if (location.hash === '#posts' && window.innerWidth <= 849) {
    document.documentElement.classList.add('posts-mode');
  }
</script>
```

Two details that matter here:

- **The class lives on `<html>`, not `<body>`.** A head script can touch `documentElement` immediately. `body` does not exist yet at that point in parsing.
- **It runs synchronously.** No `defer`, no `DOMContentLoaded`. The CSS rule must see the class on the very first style resolution.

## How the toggle actually flows

Tap POSTS on the home page. The handler intercepts the click, adds `html.posts-mode`, and the `html:not(.posts-mode)` CSS rule no longer matches. Chirpy's normal mobile layout renders.

Tap HOME from anywhere. Chirpy's existing `/` link reloads the page. There is no hash and no class, so the default menu view returns.

Tap POSTS on `/about/`. The browser navigates to `/#posts`. The head script sets `posts-mode` synchronously. The home page renders directly in posts view. The `DOMContentLoaded` handler then strips `#posts` from the URL bar so a refresh returns to menu view.

## Why this approach

- **Zero markup changes.** Everything works through CSS scoping and JavaScript injection. `_layouts/home.html` stays untouched, so Chirpy upgrades will not break it.
- **Reversible.** Delete the CSS block, delete the script tags from `metadata-hook.html`, and the site is back to vanilla Chirpy.
- **Minimal new code.** No new layouts, no new components. One CSS block and two JavaScript blocks.

## Trade offs to know

- **POSTS is idempotent.** Tapping it always lands you in posts view. To return to menu view, the user taps HOME. If you prefer a single tab that toggles both directions, change the click handler to `html.classList.toggle('posts-mode')`.
- **The `:has()` selector requires a modern browser.** Safari 15.4+, Chrome 105+, Firefox 121+. This is fine for any current device, but if you support legacy browsers you would need a JavaScript fallback that adds a class on the body element.
- **The mobile breakpoint is hardcoded at 849px** to match Chirpy's `lg` breakpoint. If your fork uses a different breakpoint, update both the CSS media query and the JavaScript resize check.

## Wrapping up

The whole customisation is around 60 lines of CSS plus around 40 lines of JavaScript. Once it is in place, the mobile home reads as a navigation hub instead of an article feed, and a single tap is all it takes to drop into posts.

---
layout: post
title: How to Add Newsletter Subscribe Feature to Jekyll Chirpy with Brevo
description: A complete guide to adding a newsletter subscribe feature to a Jekyll Chirpy blog, with a sidebar button, a dedicated subscribe page, and a Brevo email backend.
date: 2026-04-27 14:00:00 +0800
published: true
categories: jekyll
toc: true
media_subpath: /assets/media/2026/how-to-add-newsletter-subscribe-feature-to-jekyll-chirpy-with-brevo
image: subscribe.png
tags: [chirpy, brevo, subscribe, jekyll]
---

If you publish regularly, a newsletter gives you something that search engines and social platforms cannot: a direct line to readers who actually want to hear from you.

Search rankings shift. Social feeds prune. Algorithms decide who sees what, and they change without warning. Email is the one channel where, if someone subscribes, you reach them. The list compounds over time. A subscriber from a year ago still receives your next post.

Three reasons make the setup work worth doing:

- **Algorithm independence.** The audience is yours, not rented from a platform. If a search update changes your traffic next quarter, the newsletter list is unaffected.
- **Reach the readers who care most.** Most visitors arrive via search, read one post, and leave. The few who subscribe are the ones who want the next post too. Sending it to them costs a few minutes per issue.
- **A real engagement signal.** Page views are noisy. Open rates and click rates tell you what content is landing, which is useful for deciding what to write next.

The setup below adds this channel to your Chirpy site without locking you into any one provider. Brevo handles the email side. The front end stays under your control.

## What we are building

Two pieces working together:

1. A **SUBSCRIBE button** in the sidebar nav. It sits as the last item, after all your tabs, with an icon and a coloured label that matches Chirpy's font and alignment. Clicking it routes to a dedicated page.
2. A **`/subscribe/` page** that hosts the full Brevo signup form. The form includes the email field, GDPR consent checkbox, captcha widget, and submit button. When a visitor signs up, Brevo handles double opt in, contact storage, and any campaign sends you trigger later.

Brevo is the email service backend. It is not the focus of this post. You could swap in Mailchimp or ConvertKit and the structural pattern below would be identical.

## Why this layout

Two design goals drove the shape of this feature.

**Conversion.** Newsletter signups are an action people skip easily. A tiny envelope icon hidden behind a hamburger gets ignored. A visible SUBSCRIBE entry in the main nav is hard to miss without being intrusive.

**Transferability.** The Brevo HTML embed code is long, full of inline styles, and account specific. If a reader wants to copy this setup to their own site, they should be able to paste their own embed verbatim into one file and have it work. No editing required.

## Architecture in one sentence

The feature is built from five pieces: one config block, two includes, one page, and a small SCSS section. The Chirpy sidebar receives a single line override that conditionally renders the button include.

| File | Role |
| ---- | ---- |
| `_config.yml` | Toggle, button label, colour preset |
| `_includes/sidebar.html` | Chirpy override, one line addition to render the button |
| `_includes/sidebar-subscribe.html` | The button list item with icon and label |
| `_includes/brevo-form.html` | Verbatim Brevo embed code, paste and go |
| `_pages/subscribe.html` | Thin page shell that wraps the Brevo include |
| `assets/css/jekyll-theme-chirpy.scss` | Button styling, colour presets, font neutralisers |

## Step 1: Get your Brevo embed code

Sign in to Brevo, then go to **Contacts**, **Forms**, and create a new subscription form. Brevo lets you customise the heading, fields, GDPR consent text, captcha provider, and styling. Once the form looks right, click **Share and Embed** and copy the **Simple HTML form** code. This snippet contains everything you need: the form action URL, hidden fields, captcha widget, scripts, and Brevo's reset stylesheet.

Keep this snippet handy. You will paste it into one file later.

A few Brevo settings worth double checking before you copy:

- **Captcha hostnames.** If Brevo's auto generated captcha is enabled, the captcha key is locked to the production domain you registered with Brevo. Submissions from `localhost` will fail with an "Invalid site key" error during local development. There are workarounds further down.
- **Double opt in.** This is on by default. New signups receive a confirmation email and only become "Confirmed" after they click the link. Recommended for compliance and list quality.
- **Confirmation email content.** Customise the confirmation email and the success page link. Visitors land here after confirming.

## Step 2: Add the subscribe block to `_config.yml`

The feature gates on a `subscribe.enabled` flag, so you can ship it disabled and turn it on when ready. Two more knobs (`text` and `color`) let you adjust the button without touching HTML.

```yaml
# Newsletter subscribe (Brevo) — sidebar button linking to /subscribe/
subscribe:
  enabled: true
  text: "Subscribe" # button label
  # Color presets: blue (default) | green | purple | orange | red | dark
  color: blue
```

Setting `enabled: false` removes the button entirely. The label text is uppercased automatically at render time using Liquid's `| upcase` filter (covered in Step 4), so writing `"Subscribe"` here yields `SUBSCRIBE` in the rendered nav, matching Chirpy's tab convention.

## Step 3: Override the Chirpy sidebar

Chirpy ships with `_includes/sidebar.html` inside the gem. Jekyll's theme system lets you override any gem file by creating a file at the same path in your project. The override approach has two strengths:

- The override file stays a near verbatim copy of Chirpy's original. When Chirpy releases a new version, you can re diff and re apply your single line addition.
- Reverting is one delete away. Remove your project's `_includes/sidebar.html` and Jekyll falls back to the gem.

Find Chirpy's sidebar at `vendor/bundle/ruby/<version>/gems/jekyll-theme-chirpy-<version>/_includes/sidebar.html`. Copy the file verbatim to `_includes/sidebar.html` in your project.

Then add **one line** inside the `<ul class="nav">` block, right after the `{%raw%}{% endfor %}{%endraw%}` that closes the tabs loop. This makes the subscribe button render as the last item in the nav, after every tab, regardless of tab order.

{% raw %}
```liquid
{% for tab in site.tabs %}
  <!-- existing tab rendering -->
{% endfor %}
{% if site.subscribe.enabled %}{% include sidebar-subscribe.html %}{% endif %}
```
{% endraw %}

The conditional is what gates the feature on the `_config.yml` flag. With `enabled: false`, the line is a no op and nothing renders.

## Step 4: Create the sidebar button include

Create `_includes/sidebar-subscribe.html` with the markup for the button itself. It is one `<li>` containing an `<a>` with an icon and a span. The structure matches Chirpy's tab markup so the button inherits Chirpy's nav alignment and font sizing automatically.

{% raw %}
```html
<li class="nav-item nav-item-subscribe">
  <a
    href="{{ '/subscribe/' | relative_url }}"
    class="nav-link nav-link-subscribe"
    data-color="{{ site.subscribe.color | default: 'blue' }}"
  >
    <i class="fa-fw fas fa-bell"></i>
    <span>{{ site.subscribe.text | default: 'Get Updates' | upcase }}</span>
  </a>
</li>
```
{% endraw %}

A few details that earn their place:

- **`fa-fw`** is Font Awesome's fixed width modifier. Combined with Chirpy's existing icon styles, the bell icon takes the same column width as every tab icon, so labels line up vertically.
- **`fas fa-bell`** is the solid bell icon, the same shape that has trained users to associate "subscribe" with this glyph thanks to YouTube. Swap to `far fa-bell` for the lighter outline version, or `fas fa-envelope` for a more email forward look.
- **`data-color`** is read by the SCSS file in Step 7. The CSS variable cascade lets you change the icon and text colour by editing one line in `_config.yml`, no markup changes.
- **`| upcase`** mirrors how Chirpy uppercases tab labels. Liquid does the transformation at render time so the HTML actually contains uppercase letters, not just CSS visual transforms.

## Step 5: Create the verbatim Brevo embed include

Create `_includes/brevo-form.html` and paste the **entire Brevo embed code from Step 1** into it. Do not strip or modify anything. The verbatim approach is what makes this feature transferable.

The file should look like this at the top:

{% raw %}
```liquid
{%- comment -%}
  Brevo signup form embed — paste-and-go.

  To replace with your own Brevo form:
    1. Brevo dashboard → Contacts → Forms → [your form] → Share & Embed
    2. Copy the "Simple HTML form" embed code
    3. Replace EVERYTHING below this comment with your pasted code

  No need to edit anything else. The page wrapper at _pages/subscribe.html
  and the SCSS overrides in assets/css/jekyll-theme-chirpy.scss handle
  visual integration with the Chirpy theme automatically.
{%- endcomment -%}

<!-- Begin Brevo Form -->
... (your Brevo embed code) ...
<!-- End Brevo Form -->
```
{% endraw %}

The Liquid comment at the top documents the workflow. Anyone cloning your site can paste their own Brevo embed below it without touching anything else. The SCSS file in Step 7 contains font and link colour overrides that visually integrate the form with Chirpy without modifying the embed itself.

## Step 6: Create the subscribe page

Create `_pages/subscribe.html` as a thin shell that wraps the Brevo include. This is what visitors see at `linsnotes.com/subscribe/` (substitute your domain).

{% raw %}
```html
---
layout: page
title: Subscribe
permalink: /subscribe/
compress_html: false
---

<div class="subscribe-page">
  {% include brevo-form.html %}
</div>
```
{% endraw %}

Three details:

- **`layout: page`** uses Chirpy's standard page layout, so the subscribe page inherits your site header, footer, sidebar, and theme colours.
- **`compress_html: false`** is important. Brevo's embed contains `<script>` blocks with global variables that get assigned before its `main.js` runs. HTML compression can mangle these in subtle ways. Disabling compression on this page only is the safe call.
- **`<div class="subscribe-page">`** is a hook for the SCSS in the next step. Wrapping the include with a single class lets all visual overrides scope to this page only without leaking elsewhere.

## Step 7: Add the SCSS

Append the following to `assets/css/jekyll-theme-chirpy.scss`. Three blocks: the button styling with colour presets, the page wrapper styling with font neutralisers, and a link colour override.

```scss
/* ------------------------------------------------------------------
 * Sidebar SUBSCRIBE button. Renders as the last item in <ul class="nav">,
 * after all tabs. Controlled by `subscribe.{enabled,text,color}` in
 * _config.yml. Colour presets via [data-color="..."]; default is blue.
 * ------------------------------------------------------------------ */
.nav-item-subscribe {
  list-style: none;
}

/* Let the <a> behave like a regular Chirpy nav-link. Icon and text
 * inherit Chirpy's tab styling so they align with the other tabs.
 * Only override the colour of the inner <span> and <i>. */
.nav-link-subscribe {
  /* default text and icon colour (blue preset fallback) */
  --sub-color: #0969da;

  i,
  span {
    color: var(--sub-color) !important;
  }

  /* Colour presets, driven by the data-color attribute */
  &[data-color='blue']   { --sub-color: #0969da; }
  &[data-color='green']  { --sub-color: #10a344; }
  &[data-color='purple'] { --sub-color: #6f42c1; }
  &[data-color='orange'] { --sub-color: #fd7e14; }
  &[data-color='red']    { --sub-color: #d73a49; }
  &[data-color='dark']   { --sub-color: #24292e; }
}

/* ------------------------------------------------------------------
 * /subscribe/ page. Visual integration overrides for the verbatim
 * Brevo embed in _includes/brevo-form.html. Lets readers paste their
 * Brevo embed as is while the form still inherits site typography.
 * ------------------------------------------------------------------ */
.subscribe-page {
  max-width: 540px;
  margin: 1rem auto;

  /* Brevo's embed loads Roboto via @font-face and applies Helvetica
   * via inline styles. Force everything inside the form to inherit
   * the Chirpy font stack so it matches the rest of the site. */
  .sib-form,
  .sib-form * {
    font-family: inherit !important;
  }

  /* Override Brevo's inline link colour with the site's blue. */
  #sib-container a {
    text-decoration: none;
    color: #0969da;
  }
}
```

How the colour presets work: the CSS variable `--sub-color` cascades from the `data-color` attribute on the link down into the icon and span colour rules. Editing `color: green` in `_config.yml` re paints the button without any other changes.

How the font neutraliser works: Brevo's embed declares Roboto fonts via `@font-face` and applies `font-family: Helvetica, sans-serif` through inline styles on each form block. The `font-family: inherit !important` rule overrides both, so the form picks up Chirpy's font stack and the form blends visually with the rest of your site.

## Build and check the result

Run `bundle exec jekyll serve` and open the site at `http://127.0.0.1:4000`. You should see:

- The **SUBSCRIBE** button as the last item in the sidebar nav, with the bell icon and the configured colour.
- Clicking the button takes you to `/subscribe/`.
- The Brevo form renders inside the page with the site header and footer wrapping it. Fonts match the rest of the site. Submit button stays Brevo's green by default.

Toggle off and on by flipping `subscribe.enabled` in `_config.yml`. Cycle the colour preset to see how the button updates. Edit `text:` and reload to see the label change.

## The captcha hostnames gotcha

If you submit the form locally and see "ERROR for site owner: Invalid site key", the captcha widget is rejecting the request because your captcha key is registered to your production domain only. This is the most common issue developers run into during local testing.

**Fix A**: register your own Cloudflare Turnstile or Google reCAPTCHA, then add `localhost` and `127.0.0.1` to its hostname allowlist along with your production domain. Paste the new Site Key and Secret Key into the Brevo form designer's Captcha settings, and Brevo regenerates the embed code. Replace the contents of `_includes/brevo-form.html` with the new embed.

**Fix B**: skip local testing of the captcha. The rest of the form is fully testable on `localhost`. Push to production and submit a real test from there.

**Fix C**: temporarily disable the captcha block in the Brevo form designer for local testing only. Re enable before going live to avoid spam signups. The form embed code regenerates each time you change captcha settings, so remember to refresh the contents of `_includes/brevo-form.html`.

## Adapting to your site

Once the feature is in, every customisation comes from one of these surfaces:

- **Change the button text**: edit `_config.yml`, `subscribe.text`.
- **Change the button colour**: edit `_config.yml`, `subscribe.color`. Pick from the six presets, or add your own preset to the SCSS file.
- **Change the icon**: edit `_includes/sidebar-subscribe.html`, swap `fas fa-bell` for any Font Awesome class.
- **Change the form**: regenerate in Brevo dashboard, copy the new embed code, paste it into `_includes/brevo-form.html` replacing the old contents.
- **Change the form fields**: add or remove fields in Brevo, then re paste. The Liquid wrapper and SCSS handle integration; the markup inside is whatever Brevo gives you.

## Wrapping up

The feature is around 60 lines of new Liquid plus around 25 lines of SCSS, on top of one Chirpy sidebar override that adds a single line. The Brevo embed itself is whatever your Brevo account generates, kept in its own file so it can be replaced wholesale without touching any other code. The result is a clean newsletter signup that fits naturally into Chirpy's design and routes through a battle tested email service.

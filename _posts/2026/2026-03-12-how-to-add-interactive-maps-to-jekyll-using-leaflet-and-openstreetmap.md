---
layout: post
title: How to Add Interactive Maps to Jekyll Using Leaflet and OpenStreetMap
date: 2026-03-12 18:00:00 +0800
published: true
categories: website
tags: [jekyll, leaflet, openstreetmap, map, tutorial]
media_subpath: /assets/media/2026/how-to-add-interactive-maps-to-jekyll-using-leaflet-and-openstreetmap/
image: leaflet_openstreetmap.png
map:
  center: [1.3521, 103.8198]
  zoom: 11
  height: 450px
  style: default
  markers:
    - coords: [1.3521, 103.8198]
      popup: "Marina Bay Sands"
      open: true
    - coords: [1.2838, 103.8591]
      popup: "Changi Airport"
---

This guide shows how to integrate interactive [Leaflet](https://leafletjs.com/) maps with [OpenStreetMap](https://www.openstreetmap.org/) tiles into a Jekyll static site — using only front matter configuration and a single Liquid tag. No npm, no gems, no build changes required.

Here's what the result looks like:

{% map %}

---

## How It Works

The integration uses three files working together:

| File                           | Role                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `_plugins/posts-map-tag.rb`    | Registers `{% raw %}{% map %}{% endraw %}` as a custom Liquid tag |
| `_includes/metadata-hook.html` | Conditionally loads Leaflet CSS/JS only on pages with a map       |
| `assets/js/map-renderer.js`    | Reads data attributes from the HTML and initialises the map       |

The data flow is straightforward:

```
Front matter (YAML) → Plugin outputs <div> with data-* attributes → JS reads attributes → Leaflet renders map
```

Posts without `map:` in their front matter load zero additional assets.

---

## Step 1 — Create the Plugin

Create `_plugins/posts-map-tag.rb`:

```ruby
require 'json'

module Jekyll
  class MapTag < Liquid::Tag
    def initialize(tag_name, markup, tokens)
      super
    end

    def render(context)
      page = context.registers[:page]
      map_data = page['map']
      return '' unless map_data

      center = map_data['center']
      zoom = map_data['zoom'] || 13
      height = map_data['height'] || '450px'
      width = map_data['width'] || '100%'
      style = map_data['style'] || 'default'
      markers = map_data['markers'] || []

      <<~HTML
        <div class="leaflet-map"
          data-center="#{center.join(',')}"
          data-zoom="#{zoom}"
          data-style="#{style}"
          data-markers='#{JSON.generate(markers)}'
          style="height: #{height}; width: #{width}; border-radius: 8px;">
        </div>
      HTML
    end
  end
end

Liquid::Template.register_tag('map', Jekyll::MapTag)
```

This plugin reads the `map:` block from the post's front matter and outputs an HTML `<div>` with all the configuration stored as `data-*` attributes. The div itself contains no JavaScript — it's pure HTML. If no `map:` key exists in the front matter, it outputs nothing.

---

## Step 2 — Edit the Metadata Hook

Edit `_includes/metadata-hook.html` to conditionally load Leaflet:

```html
{% raw %}{% if page.map %}
<link
  rel="stylesheet"
  href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="/assets/js/map-renderer.js" defer></script>
{% endif %}{% endraw %}
```

> If you're using the Chirpy theme, `metadata-hook.html` is automatically injected into the `<head>` of every page. Other themes may use different hook files — check your theme's documentation.
> {: .prompt-info }

The `{% raw %}{% if page.map %}{% endraw %}` conditional ensures Leaflet's CSS (~40KB), JS (~42KB), and your renderer script only load on pages that actually use a map.

---

## Step 3 — Create the Map Renderer

Create `assets/js/map-renderer.js`:

```javascript
(function () {
  var tileProviders = {
    default: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    },
    light: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    },
  };

  document.querySelectorAll(".leaflet-map").forEach(function (el) {
    var center = el.dataset.center.split(",").map(Number);
    var zoom = parseInt(el.dataset.zoom);
    var style = el.dataset.style || "default";
    var markers = JSON.parse(el.dataset.markers || "[]");

    var provider = tileProviders[style] || tileProviders["default"];

    var map = L.map(el).setView(center, zoom);

    L.tileLayer(provider.url, {
      attribution: provider.attribution,
      maxZoom: 19,
    }).addTo(map);

    markers.forEach(function (m) {
      var marker = L.marker(m.coords).addTo(map);
      if (m.popup) {
        marker.bindPopup(m.popup);
        if (m.open) {
          marker.openPopup();
        }
      }
    });
  });
})();
```

The renderer finds all `.leaflet-map` divs, reads their `data-*` attributes, and calls the Leaflet API to render each map. Four tile providers are included — all free, no API keys required.

---

## Usage

### Front Matter Options

```yaml
map:
  center: [1.3521, 103.8198] # required — [latitude, longitude]
  zoom: 12 # optional — 1 (world) to 18 (street), default: 13
  height: 500px # optional — any CSS value, default: 450px
  width: 100% # optional — any CSS value, default: 100%
  style: default # optional — default | dark | light | satellite
  markers: # optional — array of markers
    - coords: [1.3521, 103.8198] # required — [latitude, longitude]
      popup: "Marina Bay Sands" # optional — popup text on click
      open: true # optional — popup opens on load
```

### Post Body

Place the map anywhere in your markdown:

```liquid
{% raw %}{% map %}{% endraw %}
```

### Tile Styles

| Value       | Source              | Best for                  |
| ----------- | ------------------- | ------------------------- |
| `default`   | OpenStreetMap       | General use               |
| `dark`      | CartoDB Dark Matter | Dark-themed sites         |
| `light`     | CartoDB Positron    | Minimal, clean look       |
| `satellite` | ESRI World Imagery  | Aerial/geographic context |

---

## Why This Approach

There were several ways to integrate maps into Jekyll. Here's why this design was chosen:

- **Data in front matter** — map configuration stays with the post metadata, not buried in the content
- **No inline JavaScript in markdown** — the `{% raw %}{% map %}{% endraw %}` tag outputs only an HTML div; all JS lives in `map-renderer.js`
- **Conditional loading** — Leaflet assets only load on pages that use maps
- **Plugin over include** — `{% raw %}{% map %}{% endraw %}` is cleaner than `{% raw %}{% include leaflet-map.html %}{% endraw %}`, and the rendering logic lives in Ruby rather than Liquid templates generating JavaScript

---

## Finding Coordinates

To get the latitude and longitude for any location:

1. Open [Google Maps](https://maps.google.com)
2. Right-click on any point
3. Click the coordinates that appear — they're copied to your clipboard
4. Paste into your front matter as `[latitude, longitude]`

---

## Notes

- **Restart Jekyll** after creating the plugin — new files in `_plugins/` require a server restart
- **GitHub Pages** does not support custom plugins with its default build. If you deploy via GitHub Actions (which Chirpy uses), plugins work fine
- Leaflet is loaded from [unpkg CDN](https://unpkg.com/) — no local files to manage or update

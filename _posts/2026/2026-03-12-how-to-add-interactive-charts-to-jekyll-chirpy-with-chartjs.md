---
layout: post
title: How to Add Interactive Charts to Jekyll Chirpy with Chart.js
date: 2026-03-12 23:00:00 +0800
media_subpath: /assets/media/2026/how-to-add-interactive-charts-to-jekyll-chirpy-with-chartjs
image: chartjs.png
published: true
categories: website
tags: [jekyll, chirpy, chartjs, data-visualization, tutorial]
charts:
  - id: yearly
    type: line
    title: "HDB Average Resale Price by Year (2017–2026)"
    data: /assets/data/hdb-yearly-avg.csv
    xAxis: year
    yAxis: avg_price
  - id: towns
    type: bar
    title: "Top 10 Towns by Transaction Volume"
    data: /assets/data/hdb-town-top10.csv
    xAxis: town
    yAxis: avg_price
  - id: flattype
    type: bar
    title: "Average Price by Flat Type"
    data: /assets/data/hdb-flattype-avg.csv
    xAxis: flat_type
    yAxis: avg_price
  - id: inline-demo
    type: doughnut
    title: "Flat Type Distribution (Approximate)"
    data:
      labels: ["3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE", "Others"]
      datasets:
        - label: "Transactions"
          values: [53979, 96173, 55549, 16233, 4809]
---

This guide shows how to add interactive Chart.js charts to your Jekyll Chirpy theme — supporting both **inline data** and **CSV files**, with a clean Liquid tag to place charts anywhere in your post. No external plugins required beyond one small Ruby file.

We'll use real **Singapore HDB resale data** (2017–2026) to demonstrate every feature.

---

## About the Demo Dataset

The charts in this post use the [Resale Flat Prices](https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view) dataset from [data.gov.sg](https://data.gov.sg/) — Singapore's open data portal. The raw dataset contains over 226,000 transactions from January 2017 onwards, with fields like `month`, `town`, `flat_type`, `floor_area_sqm`, and `resale_price`.

Since Chart.js renders in the browser, loading 226K rows directly isn't practical. For this demo, the raw data was pre-aggregated into three small CSV files:

| File | What it contains | Rows |
|------|-----------------|------|
| `hdb-yearly-avg.csv` | Average resale price and transaction count per year | 10 |
| `hdb-town-top10.csv` | Average price for the top 10 towns by volume | 10 |
| `hdb-flattype-avg.csv` | Average price per flat type | 7 |

This is the typical workflow for Chart.js: prepare small, aggregated datasets rather than feeding in raw data.

---

## Live Demo

Before we get into the implementation, here are the charts this integration produces — all powered by the HDB resale dataset above.

### HDB Resale Price Trend (CSV — Line Chart)

{% chart yearly %}

Prices have risen steadily since 2020, crossing the $650K average in 2025.

### Top 10 Towns by Volume (CSV — Bar Chart)

{% chart towns %}

Sengkang and Punggol lead in transaction volume — both are newer towns with high turnover.

### Average Price by Flat Type (CSV — Bar Chart)

{% chart flattype %}

The jump from 5 ROOM to EXECUTIVE is significant — executive flats command a premium due to larger floor area and additional features.

### Flat Type Distribution (Inline Data — Doughnut Chart)

{% chart inline-demo %}

4 ROOM flats dominate the resale market, accounting for nearly half of all transactions.

---

## How It Works

The integration uses three files working together:

| File                           | Role                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `_includes/metadata-hook.html` | Detects chart config in front matter, loads Chart.js CDN and renderer              |
| `_plugins/posts-chart-tag.rb`  | Provides `{% raw %}{% chart %}{% endraw %}` Liquid tag for placing charts in posts |
| `assets/js/chart-renderer.js`  | Reads config, fetches CSV if needed, renders Chart.js canvas                       |

Data flow:

```
Front matter (chart/charts) → metadata-hook.html (jsonify) → window.chartConfig → chart-renderer.js → Chart.js canvas
```

Posts without `chart:` or `charts:` in the front matter load zero additional JS.

---

## Step 1 — Create the Chart Renderer

Create `assets/js/chart-renderer.js`:

```javascript
(function () {
  var configs = window.chartConfig;
  if (!configs || !configs.length) return;

  var chartDivs = document.querySelectorAll("[data-chart]");
  if (!chartDivs.length) return;

  // --- CSV Parser ---
  function parseCSV(text) {
    var lines = text.trim().split("\n");
    var headers = lines[0].split(",").map(function (h) {
      return h.trim().replace(/^["']|["']$/g, "");
    });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var values = lines[i].split(",").map(function (v) {
        return v.trim().replace(/^["']|["']$/g, "");
      });
      var row = {};
      headers.forEach(function (h, j) {
        row[h] = values[j];
      });
      rows.push(row);
    }
    return { headers: headers, rows: rows };
  }

  // --- Build Chart.js data from config ---
  function buildChartData(config, csvData) {
    if (csvData) {
      // CSV source — map columns to labels/datasets
      var labels = csvData.rows.map(function (r) {
        return r[config.xAxis];
      });
      var yColumns = Array.isArray(config.yAxis)
        ? config.yAxis
        : [config.yAxis];
      var datasets = yColumns.map(function (col) {
        return {
          label: col,
          data: csvData.rows.map(function (r) {
            return parseFloat(r[col]);
          }),
        };
      });
      return { labels: labels, datasets: datasets };
    }

    // Inline data
    var data = config.data;
    return {
      labels: data.labels,
      datasets: data.datasets.map(function (ds) {
        return { label: ds.label, data: ds.values };
      }),
    };
  }

  // --- Render a single chart ---
  function renderChart(div, config, csvData) {
    var canvas = document.createElement("canvas");
    div.appendChild(canvas);

    var chartData = buildChartData(config, csvData);

    var options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {},
    };

    if (config.title) {
      options.plugins.title = { display: true, text: config.title };
    }

    new Chart(canvas, {
      type: config.type || "bar",
      data: chartData,
      options: options,
    });
  }

  // --- Process: fetch CSV if needed, then render ---
  function processChart(div, config) {
    if (typeof config.data === "string") {
      fetch(config.data)
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (text) {
          renderChart(div, config, parseCSV(text));
        })
        .catch(function (err) {
          div.textContent = "Error loading chart data: " + err.message;
        });
    } else {
      renderChart(div, config, null);
    }
  }

  // --- Match divs to configs and render ---
  for (var i = 0; i < chartDivs.length; i++) {
    var div = chartDivs[i];
    var id = div.getAttribute("data-chart");
    var config;

    if (!id || id === "") {
      config = configs[0];
    } else {
      for (var j = 0; j < configs.length; j++) {
        if (configs[j].id === id) {
          config = configs[j];
          break;
        }
      }
    }

    if (config) {
      processChart(div, config);
    }
  }
})();
```

---

## Step 2 — Add Responsive CSS

Add this block to `assets/css/jekyll-theme-chirpy.scss` (after the existing custom styles):

```scss
// Chart.js responsive containers
[data-chart] {
  position: relative;
  width: 100%;
  height: 280px;

  @media (min-width: 768px) {
    height: 400px;
  }
}
```

This gives every chart container a fixed height — 280px on mobile, 400px on desktop. Combined with `maintainAspectRatio: false` in the renderer, Chart.js fills the container exactly without distortion.

---

## Step 3 — Create the Liquid Tag Plugin

Create `_plugins/posts-chart-tag.rb`:

```ruby
module Jekyll
  class ChartTag < Liquid::Tag
    def initialize(tag_name, markup, tokens)
      super
      @chart_id = markup.strip
    end

    def render(context)
      if @chart_id.empty?
        '<div data-chart></div>'
      else
        %(<div data-chart="#{@chart_id}"></div>)
      end
    end
  end
end

Liquid::Template.register_tag('chart', Jekyll::ChartTag)
```

This converts `{% raw %}{% chart %}{% endraw %}` into `<div data-chart></div>` and `{% raw %}{% chart myid %}{% endraw %}` into `<div data-chart="myid"></div>`.

---

## Step 4 — Edit the Metadata Hook

Add this block to `_includes/metadata-hook.html`:

```html
{% raw %}{% if page.chart or page.charts %}
<script>
  window.chartConfig = {% if page.charts %}{{ page.charts | jsonify }}{% else %}[{{ page.chart | jsonify }}]{% endif %};
</script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script src="/assets/js/chart-renderer.js" defer></script>
{% endif %}{% endraw %}
```

This does three things:

1. Normalises `chart:` (single) and `charts:` (multiple) into a single array on `window.chartConfig`
2. Loads Chart.js 4.x from jsdelivr CDN
3. Loads the renderer script (deferred)

---

## Usage Examples

### Single chart — inline data

```yaml
---
chart:
  type: bar
  title: "Quarterly Revenue"
  data:
    labels: ["Q1", "Q2", "Q3", "Q4"]
    datasets:
      - label: "Revenue ($K)"
        values: [120, 150, 180, 210]
---
```

```markdown
{% raw %}{% chart %}{% endraw %}
```

### Single chart — CSV file

```yaml
---
chart:
  type: line
  title: "HDB Resale Prices"
  data: /assets/data/hdb-yearly-avg.csv
  xAxis: year
  yAxis: avg_price
---
```

```markdown
{% raw %}{% chart %}{% endraw %}
```

### Multiple charts

```yaml
---
charts:
  - id: prices
    type: line
    title: "Price Trend"
    data: /assets/data/hdb-yearly-avg.csv
    xAxis: year
    yAxis: avg_price
  - id: towns
    type: bar
    title: "Top Towns"
    data: /assets/data/hdb-town-top10.csv
    xAxis: town
    yAxis: avg_price
---
```

```markdown
{% raw %}{% chart prices %}{% endraw %}

{% raw %}{% chart towns %}{% endraw %}
```

### Multiple Y-axis columns from CSV

```yaml
---
chart:
  type: line
  data: /assets/data/stocks.csv
  xAxis: date
  yAxis: [aapl, goog, msft]
---
```

This renders three lines on the same chart, one per column.

---

## Config Reference

| Option  | Required | Applies to      | Description                                                      |
| ------- | -------- | --------------- | ---------------------------------------------------------------- |
| `type`  | Yes      | Both            | Chart type: `bar`, `line`, `pie`, `doughnut`                     |
| `title` | No       | Both            | Title displayed above the chart                                  |
| `data`  | Yes      | Both            | CSV file path (string) or inline data (object)                   |
| `xAxis` | Yes      | CSV only        | CSV column name for the x-axis                                   |
| `yAxis` | Yes      | CSV only        | CSV column name(s) for the y-axis — string or array              |
| `id`    | Yes      | Multiple charts | Unique identifier to match `{% raw %}{% chart id %}{% endraw %}` |

### Inline data structure

```yaml
data:
  labels: ["Label 1", "Label 2", "Label 3"]
  datasets:
    - label: "Dataset Name"
      values: [10, 20, 30]
```

### Supported chart types

| Type       | Best for                      |
| ---------- | ----------------------------- |
| `bar`      | Comparing categories          |
| `line`     | Trends over time              |
| `pie`      | Proportions (single dataset)  |
| `doughnut` | Proportions with centre space |

All types supported by [Chart.js 4.x](https://www.chartjs.org/docs/latest/charts/) work — including `radar`, `polarArea`, `scatter`, and `bubble`.

---

## CSV Format

The CSV parser expects:

- First row as headers
- Comma-separated values
- No complex quoting (simple values only)

Example `hdb-yearly-avg.csv`:

```csv
year,avg_price,transactions
2017,443889,20509
2018,441282,21561
2019,432138,22186
2020,452279,23333
2021,511381,29087
2022,549714,26720
2023,571806,25754
2024,612597,27832
2025,652487,25089
2026,655286,4672
```

---

## Disabling Charts

To remove charts from a post, delete the `chart:` or `charts:` block from the front matter. No Chart.js code will load on that page.

---

## Why This Approach

- **No build-time dependencies** — Chart.js loads from CDN, no `npm install` needed
- **Config-driven** — all chart setup lives in front matter YAML, no JS editing needed per post
- **Conditional loading** — Chart.js only loads on pages that use charts
- **Two data sources** — inline YAML for small datasets, CSV files for larger ones
- **Placement control** — `{% raw %}{% chart id %}{% endraw %}` lets you put charts anywhere in your post with commentary around them
- **Same pattern** — follows the same architecture as the [map integration](/posts/how-to-add-interactive-maps-to-jekyll-using-leaflet-and-openstreetmap/) (front matter + plugin + renderer)

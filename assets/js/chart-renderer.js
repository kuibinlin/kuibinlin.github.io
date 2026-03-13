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

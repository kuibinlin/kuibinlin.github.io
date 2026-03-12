(function () {
  var tileProviders = {
    default: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
    },
    light: {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>'
    }
  };

  document.querySelectorAll('.leaflet-map').forEach(function (el) {
    var center = el.dataset.center.split(',').map(Number);
    var zoom = parseInt(el.dataset.zoom);
    var style = el.dataset.style || 'default';
    var markers = JSON.parse(el.dataset.markers || '[]');

    var provider = tileProviders[style] || tileProviders['default'];

    var map = L.map(el).setView(center, zoom);

    L.tileLayer(provider.url, {
      attribution: provider.attribution,
      maxZoom: 19
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
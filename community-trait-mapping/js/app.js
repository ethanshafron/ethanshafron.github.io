// app.js — Sierra Nevada Drought Traits Interactive Map
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let map, sitesLayer, currentRasterLayer;
let pcaData = null, rasterStats = {};
let allFeatures = [];         // all GeoJSON features with traits
let siteLayerMap = {};        // siteId → Leaflet layer
let activeSiteFeature = null, activeLayer = null;
let globalPCAChart = null;    // persistent floating PCA
let sitePCAChart = null;      // biplot inside site panel
let currentPhotos = [], photoIdx = 0;
let layerCtrlOpen = false, pcaPanelCollapsed = false;
// Prevents the map-level click handler from closing a panel that was just opened
// by a marker click (Leaflet fires map click after marker click).
let suppressNextMapClick = false;

// Species → color for PCA dots
const SPECIES_COLOR = {
  PICO: '#FF9800', PIJE: '#FB8C00', PILA: '#F57C00', PIPO: '#E65100',
  ABCO: '#42A5F5', ABMA: '#1565C0',
  CADE: '#43A047',
  PSME: '#8D6E63',
  QUCHR: '#AB47BC', QUKE: '#7B1FA2',
  ACMA: '#26C6DA', ALRH: '#00ACC1', CONU: '#00838F',
};
const DEFAULT_COLOR = '#9E9E9E';

function speciesColor(code) {
  return SPECIES_COLOR[code] || DEFAULT_COLOR;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  setupControls();

  const [geojson, pca, stats] = await Promise.all([
    fetch('data/sites.geojson').then(r => r.json()),
    fetch('data/pca_data.json').then(r => r.json()).catch(() => null),
    fetch('data/raster_stats.json').then(r => r.json()).catch(() => ({})),
  ]);

  pcaData = pca;
  rasterStats = stats;
  allFeatures = (geojson.features || []).filter(f => f.properties.has_traits);

  addSiteMarkers(geojson);

  if (pcaData) initGlobalPCA();
});

// ── Map ───────────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center: CONFIG.MAP_CENTER, zoom: CONFIG.MAP_ZOOM, zoomControl: false });

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
  );
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenTopoMap', maxZoom: 17,
  });
  satellite.addTo(map);

  L.control.layers({ 'Satellite': satellite, 'Topographic': topo }, {}, { position: 'topright' }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  // Close the site panel on map-background clicks, but not when a marker was
  // just clicked (Leaflet always fires the map click after the marker click).
  map.on('click', () => {
    if (suppressNextMapClick) { suppressNextMapClick = false; return; }
    closePanel();
  });
}

// ── Markers ───────────────────────────────────────────────────────────────────
function markerStyle(feature, highlighted = false) {
  const hasTraits = feature.properties.has_traits;
  const spColor  = hasTraits ? speciesColor(feature.properties.dom_overstory) : '#9E9E9E';
  return {
    radius:      highlighted ? 12 : (hasTraits ? 9 : 7),
    fillColor:   highlighted ? '#FF5722' : spColor,
    color:       highlighted ? '#FF5722' : '#fff',
    weight:      highlighted ? 3 : 1.5,
    opacity:     1,
    fillOpacity: highlighted ? 1 : 0.85,
  };
}

function addSiteMarkers(geojson) {
  siteLayerMap = {};

  sitesLayer = L.geoJSON(geojson, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, markerStyle(feature)),
    onEachFeature: (feature, layer) => {
      siteLayerMap[feature.properties.site] = layer;
      layer.on({
        click() {
          suppressNextMapClick = true;   // block the map click that fires right after
          openSitePanel(feature, layer);
        },
        mouseover(e) {
          if (feature !== activeSiteFeature)
            e.target.setStyle({ radius: feature.properties.has_traits ? 11 : 9, fillOpacity: 1 });
        },
        mouseout(e) {
          if (feature !== activeSiteFeature) sitesLayer.resetStyle(e.target);
        },
      });
    },
  }).addTo(map);
}

// ── Panel open / close ────────────────────────────────────────────────────────
function openSitePanel(feature, layer) {
  if (activeLayer) sitesLayer.resetStyle(activeLayer);

  activeSiteFeature = feature;
  activeLayer = layer;
  layer.setStyle(markerStyle(feature, true));

  const p = feature.properties;
  document.getElementById('panel-title').textContent = `Site ${p.site}`;

  renderMetadata(p);
  renderPhotos(p);
  renderTraitProfile(p);
  renderSitePCA(p);

  document.getElementById('panel').classList.add('open');
  document.getElementById('app').classList.add('panel-open');
  setTimeout(() => map.invalidateSize({ animate: false }), 310);

  // Highlight the point in the global PCA
  highlightGlobalPCA(p.site);
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('app').classList.remove('panel-open');
  setTimeout(() => map.invalidateSize({ animate: false }), 310);

  if (activeLayer) sitesLayer.resetStyle(activeLayer);
  activeSiteFeature = null;
  activeLayer = null;

  if (sitePCAChart) { sitePCAChart.destroy(); sitePCAChart = null; }
  highlightGlobalPCA(null);
}

// ── Metadata ──────────────────────────────────────────────────────────────────
function renderMetadata(p) {
  const sp = code => (code && CONFIG.SPECIES[code])
    ? `${CONFIG.SPECIES[code]} <em>(${code})</em>`
    : (code || '—');

  const rows = [
    ['Dominant',       sp(p.dom_overstory)],
    ['Co-dominant',    sp(p.codom_overstory)],
    ['Canopy closure', p.canopy_closure || '—'],
    ['Understory',     p.dom_understory || '—'],
    p.n_trees > 0 ? ['Trees cored', p.n_trees] : null,
  ].filter(Boolean);

  const dist = [];
  if (p.beetles   === 'yes') dist.push('<span class="badge badge-warn">Beetle damage</span>');
  if (p.fires     === 'yes') dist.push('<span class="badge badge-fire">Fire history</span>');
  if (p.livestock === 'yes') dist.push('<span class="badge badge-info">Livestock</span>');

  const noTraits = p.has_traits ? '' : '<p class="no-traits">No leaf trait data yet for this site.</p>';

  document.getElementById('site-meta').innerHTML = `
    <dl class="meta-grid">
      ${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
    </dl>
    ${dist.length ? `<div class="badges">${dist.join('')}</div>` : ''}
    ${noTraits}
  `;
}

// ── Photos ────────────────────────────────────────────────────────────────────
function renderPhotos(p) {
  currentPhotos = p.photos || [];
  photoIdx = 0;
  const display = document.getElementById('photo-display');
  const nav     = document.getElementById('photo-nav');

  if (!currentPhotos.length) {
    display.innerHTML = '<p class="no-data">No photos recorded for this site.</p>';
    nav.classList.add('hidden');
    return;
  }
  nav.classList.toggle('hidden', currentPhotos.length <= 1);
  showPhoto();
}

function showPhoto() {
  const photo = currentPhotos[photoIdx];
  document.getElementById('photo-display').innerHTML = `
    <div class="photo-frame">
      <img src="${photo.url}"
           alt="Site photo ${photoIdx + 1} of ${currentPhotos.length}"
           loading="lazy"
           onerror="this.closest('.photo-frame').innerHTML='<p class=\\'no-data\\'>Photo unavailable.</p>'">
    </div>`;
  document.getElementById('photo-count').textContent = `${photoIdx + 1} / ${currentPhotos.length}`;
}

document.getElementById('photo-prev').addEventListener('click', () => {
  photoIdx = (photoIdx - 1 + currentPhotos.length) % currentPhotos.length;
  showPhoto();
});
document.getElementById('photo-next').addEventListener('click', () => {
  photoIdx = (photoIdx + 1) % currentPhotos.length;
  showPhoto();
});

// ── Trait Profile (percentile strips) ─────────────────────────────────────────
function getPercentile(trait, value) {
  if (value == null) return null;
  const vals = allFeatures.map(f => f.properties[trait]).filter(v => v != null).sort((a, b) => a - b);
  if (!vals.length) return null;
  const rank = vals.filter(v => v <= value).length;
  return Math.round((rank / vals.length) * 100);
}

function renderTraitProfile(p) {
  const section = document.getElementById('trait-profile-section');
  if (!p.has_traits) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const traits = pcaData ? pcaData.trait_names : CONFIG.TRAIT_NAMES;
  const html = traits.map(t => {
    const val = p[t];
    const pct = getPercentile(t, val);
    if (val == null || pct == null) return '';

    // Color the bar fill from blue (low) to orange (high)
    const hue = Math.round(240 - pct * 1.8);   // 240=blue → 60=yellow → 0=red
    const color = `hsl(${hue}, 80%, 48%)`;
    const label = ordinal(pct);

    return `
      <div class="trait-strip">
        <span class="ts-name">${t}</span>
        <div class="ts-track">
          <div class="ts-fill" style="width:${pct}%; background:${color}"></div>
          <div class="ts-dot" style="left:calc(${pct}% - 5px)"></div>
        </div>
        <span class="ts-stat">${val.toFixed(1)} <em>${label}</em></span>
      </div>`;
  }).join('');

  document.getElementById('trait-profile').innerHTML = html;
}

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]) + ' %ile';
}

// ── Site PCA biplot ────────────────────────────────────────────────────────────
function renderSitePCA(p) {
  const section = document.getElementById('pca-section');
  if (!pcaData || !p.has_traits || !p.pcs || p.pcs[0] === null) {
    section.style.display = 'none'; return;
  }
  section.style.display = 'block';
  drawSitePCA(p);
}

// Chart.js plugin that draws loading arrows on top of the scatter
function makeBiplotPlugin(xi, yi, scale) {
  return {
    id: 'biplot',
    afterDatasetsDraw(chart) {
      if (!pcaData?.loadings || !pcaData.trait_names) return;
      const traits  = pcaData.trait_names;
      const loadings = pcaData.loadings;  // [3 PCs][n_traits]

      // Pick top 6 traits by combined loading magnitude on the two displayed axes
      const arrows = traits
        .map((name, i) => ({
          name,
          lx: loadings[xi][i] * scale,
          ly: loadings[yi][i] * scale,
          mag: Math.hypot(loadings[xi][i], loadings[yi][i]),
        }))
        .sort((a, b) => b.mag - a.mag)
        .slice(0, 6);

      const ctx = chart.ctx;
      const xs = chart.scales.x;
      const ys = chart.scales.y;
      const ox = xs.getPixelForValue(0);
      const oy = ys.getPixelForValue(0);

      ctx.save();
      arrows.forEach(({ name, lx, ly }) => {
        const ex = xs.getPixelForValue(lx);
        const ey = ys.getPixelForValue(ly);
        const angle = Math.atan2(ey - oy, ex - ox);
        const HEAD = 7;

        // Line
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = 'rgba(229,57,53,0.70)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([]);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - HEAD * Math.cos(angle - 0.45), ey - HEAD * Math.sin(angle - 0.45));
        ctx.lineTo(ex - HEAD * Math.cos(angle + 0.45), ey - HEAD * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fillStyle = 'rgba(229,57,53,0.70)';
        ctx.fill();

        // Label — offset slightly past arrowhead
        const LABEL_OFF = 9;
        ctx.fillStyle = '#B71C1C';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = lx >= 0 ? 'left' : 'right';
        ctx.textBaseline = ly <= 0 ? 'bottom' : 'top';
        ctx.fillText(name, ex + LABEL_OFF * Math.cos(angle), ey + LABEL_OFF * Math.sin(angle));
      });
      ctx.restore();
    },
  };
}

function drawSitePCA(p) {
  const xi = parseInt(document.getElementById('pca-x').value);
  const yi = parseInt(document.getElementById('pca-y').value);
  const ev = pcaData.explained_variance;

  // Arrow scale: use the full cross-site spread so arrows are consistently sized
  const vals = pcaData.sites.filter(s => s.pcs[xi] != null && s.pcs[yi] != null);
  const xSpread = Math.max(...vals.map(s => s.pcs[xi])) - Math.min(...vals.map(s => s.pcs[xi]));
  const ySpread = Math.max(...vals.map(s => s.pcs[yi])) - Math.min(...vals.map(s => s.pcs[yi]));
  const arrowScale = Math.min(xSpread, ySpread) * 0.38;

  // Only the selected site — the biplot arrows provide the context
  const spColor = speciesColor(p.dom_overstory);
  const activePoint = { x: p.pcs[xi], y: p.pcs[yi] };

  const ctx = document.getElementById('pca-canvas').getContext('2d');
  if (sitePCAChart) sitePCAChart.destroy();

  sitePCAChart = new Chart(ctx, {
    type: 'scatter',
    plugins: [makeBiplotPlugin(xi, yi, arrowScale)],
    data: {
      datasets: [
        {
          label: `Site ${p.site}`,
          data: [activePoint],
          backgroundColor: spColor,
          borderColor: '#fff',
          borderWidth: 2,
          pointRadius: 9,
          pointHoverRadius: 9,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label() {
              const sp = p.dom_overstory ? ` — ${CONFIG.SPECIES[p.dom_overstory] || p.dom_overstory}` : '';
              return `Site ${p.site}${sp}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: `PC${xi+1} (${(ev[xi]*100).toFixed(1)}% variance)`, font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.06)' },
          // Fix axis range to full dataset extent so star position is meaningful
          min: Math.min(...vals.map(s => s.pcs[xi])) - xSpread * 0.08,
          max: Math.max(...vals.map(s => s.pcs[xi])) + xSpread * 0.08,
        },
        y: {
          title: { display: true, text: `PC${yi+1} (${(ev[yi]*100).toFixed(1)}% variance)`, font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.06)' },
          min: Math.min(...vals.map(s => s.pcs[yi])) - ySpread * 0.08,
          max: Math.max(...vals.map(s => s.pcs[yi])) + ySpread * 0.08,
        },
      },
    },
  });

  document.getElementById('pca-variance').innerHTML =
    `<small>Arrows show trait loadings (top 6). Star colored by dominant species.</small>`;
}

document.getElementById('pca-x').addEventListener('change', () => {
  if (activeSiteFeature) drawSitePCA(activeSiteFeature.properties);
});
document.getElementById('pca-y').addEventListener('change', () => {
  if (activeSiteFeature) drawSitePCA(activeSiteFeature.properties);
});

// ── Global / persistent PCA panel ────────────────────────────────────────────
function initGlobalPCA() {
  drawGlobalPCA();

  document.getElementById('global-pca-x').addEventListener('change', drawGlobalPCA);
  document.getElementById('global-pca-y').addEventListener('change', drawGlobalPCA);

  document.getElementById('pca-panel-toggle').addEventListener('click', () => {
    pcaPanelCollapsed = !pcaPanelCollapsed;
    const body = document.getElementById('pca-panel-body');
    body.style.display = pcaPanelCollapsed ? 'none' : 'block';
    document.getElementById('pca-panel-toggle').textContent = pcaPanelCollapsed ? '+' : '−';
  });
}

function drawGlobalPCA(highlightSite = null) {
  if (!pcaData) return;

  const xi = parseInt(document.getElementById('global-pca-x').value);
  const yi = parseInt(document.getElementById('global-pca-y').value);
  const ev = pcaData.explained_variance;

  // Split into background points and (optionally) a selected point
  const bgPoints  = [];
  const bgColors  = [];
  const selPoints = [];

  pcaData.sites
    .filter(s => s.pcs[xi] != null && s.pcs[yi] != null)
    .forEach(s => {
      const feat = allFeatures.find(f => f.properties.site === s.site);
      const dom  = feat?.properties?.dom_overstory;
      const pt   = { x: s.pcs[xi], y: s.pcs[yi], site: s.site, dom };
      if (s.site === highlightSite) {
        selPoints.push(pt);
      } else {
        bgPoints.push(pt);
        bgColors.push(chroma(speciesColor(dom)).alpha(0.75).css());
      }
    });

  const ctx = document.getElementById('global-pca-canvas').getContext('2d');
  if (globalPCAChart) globalPCAChart.destroy();

  const datasets = [
    {
      label: 'Sites',
      data: bgPoints,
      backgroundColor: bgColors,
      borderColor: bgColors.map(c => chroma(c).darken(0.7).alpha(1).css()),
      borderWidth: 1,
      pointRadius: 4,
      pointHoverRadius: 6,
    },
  ];
  if (selPoints.length) {
    datasets.push({
      label: 'Selected',
      data: selPoints,
      backgroundColor: '#FF5722',
      borderColor: '#fff',
      borderWidth: 2,
      pointRadius: 8,
      pointHoverRadius: 9,
      pointStyle: 'star',
    });
  }

  // Arrow scale based on data spread of global panel axes
  const allVals = pcaData.sites.filter(s => s.pcs[xi] != null && s.pcs[yi] != null);
  const gxSpread = Math.max(...allVals.map(s => s.pcs[xi])) - Math.min(...allVals.map(s => s.pcs[xi]));
  const gySpread = Math.max(...allVals.map(s => s.pcs[yi])) - Math.min(...allVals.map(s => s.pcs[yi]));
  const gArrowScale = Math.min(gxSpread, gySpread) * 0.38;

  globalPCAChart = new Chart(ctx, {
    type: 'scatter',
    plugins: [makeBiplotPlugin(xi, yi, gArrowScale)],
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const pt = ctx.datasetIndex === 0 ? bgPoints[ctx.dataIndex] : selPoints[ctx.dataIndex];
              if (!pt) return '';
              const sp = pt.dom ? ` — ${CONFIG.SPECIES[pt.dom] || pt.dom}` : '';
              return `Site ${pt.site}${sp}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: `PC${xi+1} (${(ev[xi]*100).toFixed(1)}%)`, font: { size: 10 } },
          grid:  { color: 'rgba(0,0,0,0.06)' },
          ticks: { font: { size: 9 } },
        },
        y: {
          title: { display: true, text: `PC${yi+1} (${(ev[yi]*100).toFixed(1)}%)`, font: { size: 10 } },
          grid:  { color: 'rgba(0,0,0,0.06)' },
          ticks: { font: { size: 9 } },
        },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        const dsIdx = elements[0].datasetIndex;
        const ptIdx = elements[0].index;
        const pt = dsIdx === 0 ? bgPoints[ptIdx] : selPoints[ptIdx];
        if (!pt) return;
        const feat = allFeatures.find(f => f.properties.site === pt.site);
        if (!feat) return;
        const [lon, lat] = feat.geometry.coordinates;
        suppressNextMapClick = true;
        map.flyTo([lat, lon], Math.max(map.getZoom(), 13), { animate: true, duration: 0.8 });
        const layer = siteLayerMap[pt.site];
        if (layer) openSitePanel(feat, layer);
      },
    },
  });
}

function highlightGlobalPCA(siteId) {
  drawGlobalPCA(siteId);
}

// ── Raster layers ─────────────────────────────────────────────────────────────
// Uses titiler (http://localhost:8008) as a COG tile server for native-resolution
// rendering at every zoom level.  Falls back to pre-built PNG tiles if titiler
// is unreachable (e.g. on GitHub Pages without a backend).
let useTitiler = null;   // null = unknown; true/false after first probe

async function probeTitiler() {
  if (useTitiler === true) return true;  // cache success only; retry on failure
  try {
    const r = await fetch(`${CONFIG.TITILER_URL}/healthz`, { signal: AbortSignal.timeout(25000) });
    useTitiler = r.ok;
  } catch {
    useTitiler = false;
  }
  return useTitiler;
}

async function loadRasterLayer(traitName) {
  if (currentRasterLayer) { map.removeLayer(currentRasterLayer); currentRasterLayer = null; }
  document.getElementById('legend').classList.add('hidden');
  if (!traitName) return;

  const stats  = rasterStats[traitName] || {};
  const vmin   = stats.p2  ?? 0;
  const vmax   = stats.p98 ?? 1;
  const opacity = parseFloat(document.getElementById('opacity-slider').value);

  const titilerUp = await probeTitiler();

  if (titilerUp) {
    // titiler: renders from COG at native resolution for each zoom level
    const cogUrl  = encodeURIComponent(`${CONFIG.RASTER_BASE_URL}/${traitName}.tif`);
    const tileUrl =
      `${CONFIG.TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png` +
      `?url=${cogUrl}&colormap_name=viridis&rescale=${vmin},${vmax}&nodata=-9999&return_mask=true`;

    currentRasterLayer = L.tileLayer(tileUrl, {
      opacity,
      bounds: CONFIG.RASTER_BOUNDS,
      maxNativeZoom: 18,
      crossOrigin: true,
    });
    setRasterStatus('', '');
  } else {
    // Fallback: pre-built PNG tiles (viridis colormap, zoom 7-13)
    setRasterStatus('titiler offline — using pre-built tiles (zoom 7–13)', 'info');
    currentRasterLayer = L.tileLayer(`tiles/${traitName}/{z}/{x}/{y}.png`, {
      opacity,
      tms: false,
      minNativeZoom: 7,
      maxNativeZoom: 13,
      bounds: CONFIG.RASTER_BOUNDS,
      errorTileUrl: '',
    });
  }

  currentRasterLayer.addTo(map);
  const cscale = chroma.scale('viridis').domain([vmin, vmax]);
  renderLegend(traitName, vmin, vmax, cscale);
}

function setRasterStatus(msg, type) {
  const el = document.getElementById('raster-status');
  el.textContent = msg;
  el.className   = type ? `status-${type}` : '';
}

function renderLegend(traitName, vmin, vmax, cscale) {
  const units = CONFIG.TRAIT_UNITS[traitName] ?? CONFIG.DEFAULT_TRAIT_UNIT;
  document.getElementById('legend').classList.remove('hidden');
  document.getElementById('legend-title').textContent = `${traitName} (${units})`;
  document.getElementById('legend-min').textContent   = vmin.toFixed(2);
  document.getElementById('legend-max').textContent   = vmax.toFixed(2);
  const canvas = document.getElementById('legend-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  for (let i = 0; i < w; i++) {
    ctx.fillStyle = cscale(vmin + (i / w) * (vmax - vmin)).hex();
    ctx.fillRect(i, 0, 1, canvas.height);
  }
}

// ── Controls ──────────────────────────────────────────────────────────────────
function setupControls() {
  document.getElementById('trait-select').addEventListener('change', e => loadRasterLayer(e.target.value));
  document.getElementById('opacity-slider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('opacity-val').textContent = `${Math.round(v * 100)}%`;
    if (currentRasterLayer) currentRasterLayer.setOpacity(v);
  });
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('layer-ctrl-header').addEventListener('click', () => {
    layerCtrlOpen = !layerCtrlOpen;
    document.getElementById('layer-ctrl-body').classList.toggle('hidden', !layerCtrlOpen);
    document.getElementById('layer-ctrl-arrow').textContent = layerCtrlOpen ? '▴' : '▾';
  });
}

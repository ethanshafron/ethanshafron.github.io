// config.js — Edit this file to configure the map for your deployment.
'use strict';

const CONFIG = {
  // ── Tile server (titiler) ───────────────────────────────────────────────────
  // Local dev:   run `conda run -n geoenv python server.py`
  // Production:  set TITILER_URL to your Render/Fly/Lambda titiler URL,
  //              set RASTER_BASE_URL to https://<you>.github.io/<repo>/rasters
  // Production titiler — deploy on Render.com and paste the URL here.
  // Until set, the app falls back to pre-built tiles (zoom 7–13).
  TITILER_URL: 'https://titiler-latest-6y2u.onrender.com',

  // COG files are served from GitHub Pages alongside the app.
  RASTER_BASE_URL: 'https://ethanshafron.github.io/community-trait-mapping/rasters',

  // ── AGOL ────────────────────────────────────────────────────────────────────
  AGOL_BASE_URL: 'https://services1.arcgis.com/ERdCHt0sNM6dENSD/arcgis/rest/services/service_9d571cfb7c3241b6b59d632653564ab9/FeatureServer/0',

  // ── Map ─────────────────────────────────────────────────────────────────────
  MAP_CENTER: [37.45, -119.35],
  MAP_ZOOM: 10,

  // ── Raster tile bounds (derived from mean_alltraits_60m.tif extent) ─────────
  // Used to avoid loading tiles outside the AVIRIS flight area.
  // Format: [[south, west], [north, east]] in WGS84
  RASTER_BOUNDS: [[36.3, -120.2], [38.3, -118.9]],

  // ── Traits ──────────────────────────────────────────────────────────────────
  // Band order matches the source TIF and the field CSV.
  TRAIT_NAMES: [
    'LMA', 'Chlorophylls', 'Sulfur', 'Phosphorus', 'Nitrogen',
    'Phenolics', 'Cellulose', 'Fiber', 'Calcium', 'NSC',
    'Lignin', 'Starch', 'Sugar', 'Potassium',
  ],

  // Key traits shown in the site popup summary
  KEY_TRAITS: ['LMA', 'NSC', 'Nitrogen', 'Lignin'],

  // ── Species lookup ──────────────────────────────────────────────────────────
  SPECIES: {
    ABCO:  'White fir',
    ABMA:  'Red fir',
    CADE:  'Incense cedar',
    ACMA:  'Bigleaf maple',
    ALRH:  'White alder',
    PICO:  'Lodgepole pine',
    PIJE:  'Jeffrey pine',
    PILA:  'Sugar pine',
    PIPO:  'Ponderosa pine',
    PSME:  'Douglas-fir',
    QUCHR: 'Canyon live oak',
    QUKE:  'California black oak',
    CONU:  'Pacific dogwood',
  },
};

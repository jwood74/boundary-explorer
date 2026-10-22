import { PROJECTS, DEFAULT_PROJECT_ID } from './projects.js';
import { datasetsForSide, initialState, normalizeDataset, projectURL, validateProject } from './project-config.js';
import { ChangeCalculator } from './change-calculator.js';

const $ = (id) => document.getElementById(id);
const requestedProject = new URLSearchParams(location.search).get('project');
const project = PROJECTS.find((entry) => entry.id === requestedProject)
  || PROJECTS.find((entry) => entry.id === DEFAULT_PROJECT_ID) || PROJECTS[0];
const DATASETS = project.datasets;
const available = DATASETS.filter((dataset) => dataset.path);
const datasetById = (id) => available.find((dataset) => dataset.id === id);
const baselineDataset = datasetById(project.baselineDataset);
const params = new URLSearchParams(location.hash.slice(1));
const boundedNumber = (key, fallback, min, max) => {
  const value = params.has(key) ? Number(params.get(key)) : NaN;
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};
const state = initialState(project, params);
const empty = { type: 'FeatureCollection', features: [] };
const cache = new Map();
const changeCache = new Map();
const calculator = new ChangeCalculator();
const maps = [];
const sourceData = new WeakMap();
const highlightedNames = [];
let generation = 0;
let ready = false;
let syncing = false;
let toastTimer;
let electorateNames = [];
let changeBounds = null;
let comparisonMapPromise = null;
let urlTimer;
let inspectionFrame;
let lastInspectionKey = '';

function setSourceData(map, id, data) {
  if (!sourceData.has(map)) sourceData.set(map, new Map());
  const previous = sourceData.get(map);
  if (previous.get(id) === data) return;
  map.getSource(id).setData(data);
  previous.set(id, data);
}

function scheduleURLUpdate() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(updateURL, 250);
}

async function loadDataset(id) {
  if (!cache.has(id)) {
    const request = (async () => {
      const dataset = datasetById(id);
      if (!dataset) throw new Error(`Dataset unavailable: ${id}`);
      const response = await fetch(dataset.path);
      if (!response.ok) throw new Error(`Could not load ${dataset.label} (HTTP ${response.status}).`);
      const data = await response.json();
      return normalizeDataset(data, project, dataset);
    })();
    cache.set(id, request);
    request.catch(() => cache.delete(id));
  }
  return cache.get(id);
}

function updateURL() {
  clearTimeout(urlTimer);
  if (!ready) return;
  const center = maps[1].getCenter();
  const hash = new URLSearchParams({
    a: state.left, b: state.right, mode: state.mode,
    lng: center.lng.toFixed(5), lat: center.lat.toFixed(5), z: maps[1].getZoom().toFixed(2),
    split: Math.round(state.split), labels: state.labels ? '1' : '0', baseline: state.baseline ? '1' : '0',
  });
  if (state.mode === 'change') hash.set('electorate', state.electorate);
  const url = projectURL(location.href, project.id);
  url.hash = hash.toString();
  if (url.href !== location.href) history.replaceState(null, '', url);
}

function updateDivider() {
  $('map-stage').style.setProperty('--split', `${state.split}%`);
  $('divider-handle').setAttribute('aria-valuenow', Math.round(state.split));
  $('divider-handle').setAttribute('aria-valuetext', `${Math.round(state.split)}% map A, ${Math.round(100 - state.split)}% map B`);
}

function updateControls() {
  for (const side of ['left', 'right']) {
    const dataset = datasetById(state[side]);
    $(`${side}-dataset`).querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.dataset === dataset.id);
    });
    $(`${side}-field`).style.setProperty('--dataset-color', dataset.color);
    $(`${side}-badge`).style.setProperty('--dataset-color', dataset.color);
    const treatment = state.mode === 'change' ? ` · ${side === 'left' ? 'From' : 'To'}` : state.mode === 'overlay' ? ` · ${side === 'left' ? 'Outline' : 'Colour fill'}` : '';
    $(`${side}-badge`).textContent = `${side === 'left' ? 'A' : 'B'} · ${dataset.label}${treatment}`;
    $(`${side}-description`).textContent = dataset.description;
    $(`${side}-direction`).textContent = state.mode === 'change' ? (side === 'left' ? 'From version' : 'To version') : state.mode === 'overlay' ? (side === 'left' ? 'Outline only' : 'Colour fill') : `${side === 'left' ? 'Left' : 'Right'} side`;
  }
  $('map-stage').classList.toggle('overlay', state.mode === 'overlay');
  $('map-stage').classList.toggle('change', state.mode === 'change');
  $('map-left').hidden = state.mode !== 'swipe';
  document.body.classList.toggle('change-mode', state.mode === 'change');
  $('change-controls').hidden = state.mode !== 'change';
  $('inspection').hidden = state.mode === 'change';
  if (state.mode !== 'change') $('change-legend').hidden = true;
  updateDivider();
  document.querySelectorAll('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.mode === state.mode));
  $('mode-help').textContent = state.mode === 'change' ? 'Click an A electorate or choose one below to see what B adds or removes.' : state.mode === 'overlay' ? 'A is an outline; B is a translucent colour fill.' : 'Drag the divider to reveal the differences.';
  $('labels').checked = state.labels;
  $('baseline').checked = state.baseline;
  const canSwap = datasetsForSide(project, 'right', { availableOnly: true }).some((dataset) => dataset.id === state.left)
    && datasetsForSide(project, 'left', { availableOnly: true }).some((dataset) => dataset.id === state.right);
  $('swap').disabled = !canSwap;
  $('swap').title = canSwap ? 'Swap the two boundary datasets' : 'These versions cannot be swapped. Choose versions available on both sides.';
}

function addLayers(map) {
  // Keep the shared Positron basemap's place names secondary to electorates.
  for (const id of ['label_city', 'label_city_capital']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }
  if (map.getLayer('label_other')) {
    // Positron groups suburbs and neighbourhoods in this place-label layer.
    map.setLayoutProperty('label_other', 'text-size', ['interpolate', ['linear'], ['zoom'], 8, 7, 12, 8.5]);
  }
  for (const id of ['boundary', 'reference', 'baseline']) map.addSource(id, { type: 'geojson', data: empty });
  map.addLayer({ id: 'boundary-fill', type: 'fill', source: 'boundary', paint: { 'fill-color': '#666b70', 'fill-opacity': 0.09 } });
  map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#666b70', 'line-width': 1.8 } });
  map.addLayer({ id: 'reference-line', type: 'line', source: 'reference', paint: { 'line-color': '#666b70', 'line-width': 2.4 } });
  map.addLayer({ id: 'baseline-line', type: 'line', source: 'baseline', paint: { 'line-color': baselineDataset?.color || '#666b70', 'line-width': 1.3, 'line-dasharray': [2, 3], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'boundary-highlight', type: 'line', source: 'boundary', filter: ['==', ['get', 'displayName'], ''], paint: { 'line-color': '#666b70', 'line-width': 4 } });
  map.addLayer({ id: 'boundary-label', type: 'symbol', source: 'boundary', layout: { 'text-field': ['get', 'displayName'], 'text-font': ['Noto Sans Regular'], 'text-size': 15, 'text-max-width': 9 }, paint: { 'text-color': '#41354d', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
  // Draw A's reference outline below B's fill, edges and highlights.
  map.moveLayer('reference-line', 'boundary-fill');
  // Transparent hit area allows selecting A by clicking anywhere inside it.
  map.addLayer({ id: 'reference-hit', type: 'fill', source: 'reference', paint: { 'fill-opacity': 0 } }, 'reference-line');
  map.addLayer({ id: 'reference-label', type: 'symbol', source: 'reference', layout: { visibility: 'none', 'text-field': ['get', 'displayName'], 'text-font': ['Noto Sans Regular'], 'text-size': 15, 'text-max-width': 9 }, paint: { 'text-color': '#666b70', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
  for (const [kind, color, opacity] of [['retained', '#66716c', 0.08], ['added', '#16835b', 0.38], ['removed', '#c44751', 0.38]]) {
    const source = `change-${kind}`;
    map.addSource(source, { type: 'geojson', data: empty });
    map.addLayer({ id: `${source}-fill`, type: 'fill', source, paint: { 'fill-color': color, 'fill-opacity': opacity } }, 'reference-line');
    if (kind !== 'retained') map.addLayer({ id: `${source}-line`, type: 'line', source, paint: { 'line-color': color, 'line-width': 1.4, ...(kind === 'removed' ? { 'line-dasharray': [2, 2] } : {}) } }, 'reference-line');
  }
}

async function render({ fitChange = false } = {}) {
  updateControls();
  if (!ready) return;
  const version = ++generation;
  calculator.cancel();
  $('map-status').hidden = false;
  $('map-status').classList.remove('error');
  $('map-status').textContent = 'Loading boundaries…';
  $('change-legend').hidden = true;
  changeBounds = null;
  try {
    if (state.mode === 'swipe') {
      if (!maps[0]) comparisonMapPromise = createMap('left', { center: maps[1].getCenter(), zoom: maps[1].getZoom() });
      await comparisonMapPromise;
    } else if (maps[0]) {
      const comparison = maps[0];
      delete maps[0];
      comparisonMapPromise = null;
      comparison.remove();
    }
    if (version !== generation) return;
    const [left, right, baseline] = await Promise.all([loadDataset(state.left), loadDataset(state.right), baselineDataset && state.baseline ? loadDataset(baselineDataset.id) : empty]);
    if (version !== generation) return;
    electorateNames = [...new Set([...left.features, ...right.features].map((feature) => feature.properties.displayName))].sort();
    if (!electorateNames.includes(state.electorate)) state.electorate = electorateNames.includes(project.defaults?.electorate) ? project.defaults.electorate : electorateNames[0] || '';
    const count = new Set(left.features.map((feature) => feature.properties.displayName)).size;
    $('project-footer').textContent = `${count} ${project.electorateLabel || 'electorates'}. A few different possibilities.`;
    $('change-electorate').replaceChildren(...electorateNames.map((name) => new Option(name, name)));
    $('change-electorate').value = state.electorate;
    const index = electorateNames.indexOf(state.electorate);
    $('electorate-position').textContent = `${index + 1} of ${electorateNames.length}`;
    $('previous-electorate').disabled = index <= 0;
    $('next-electorate').disabled = index < 0 || index >= electorateNames.length - 1;
    let changes = null;
    if (state.mode === 'change') {
      $('map-status').textContent = 'Calculating boundary changes…';
      const key = JSON.stringify([project.id, state.left, state.right, state.electorate]);
      if (!changeCache.has(key)) {
        const result = await calculator.calculate(left, right, state.electorate);
        if (version !== generation) return;
        // Bound cached geometry memory, especially on phones.
        if (changeCache.size >= 20) changeCache.delete(changeCache.keys().next().value);
        changeCache.set(key, result);
      }
      changes = changeCache.get(key);
    }
    for (let i = 0; i < maps.length; i++) {
      const map = maps[i];
      if (!map) continue;
      const dataset = datasetById(i ? state.right : state.left);
      setSourceData(map, 'boundary', changes ? (i ? changes.b : changes.a) || empty : i ? right : left);
      // In Swipe, A lives on the second map; in other modes it is a source
      // on the primary map, avoiding a hidden renderer and duplicated tiles.
      setSourceData(map, 'reference', i && (changes || state.mode === 'overlay') ? left : empty);
      setSourceData(map, 'baseline', state.baseline ? baseline : empty);
      map.setPaintProperty('boundary-fill', 'fill-color', dataset.color);
      map.setPaintProperty('boundary-fill', 'fill-opacity', changes ? 0 : state.mode === 'overlay' ? (i ? 0.14 : 0) : 0.09);
      map.setPaintProperty('boundary-line', 'line-color', dataset.color);
      map.setPaintProperty('boundary-line', 'line-width', state.mode === 'overlay' ? 0.8 : 1.8);
      map.setPaintProperty('boundary-line', 'line-opacity', state.mode === 'overlay' ? 0.5 : 1);
      map.setPaintProperty('boundary-highlight', 'line-color', dataset.color);
      map.setPaintProperty('boundary-highlight', 'line-width', state.mode === 'overlay' && i ? 2.5 : 4);
      map.setPaintProperty('boundary-label', 'text-color', dataset.color);
      map.setPaintProperty('reference-line', 'line-color', datasetById(state.left).color);
      map.setPaintProperty('reference-label', 'text-color', datasetById(state.left).color);
      map.setLayoutProperty('reference-label', 'visibility', changes && state.labels ? 'visible' : 'none');
      map.setFilter('reference-label', changes?.b ? ['!=', ['get', 'displayName'], state.electorate] : null);
      map.setPaintProperty('reference-line', 'line-dasharray', changes ? [3, 2] : [1, 0]);
      map.setLayoutProperty('boundary-highlight', 'visibility', changes || state.mode === 'overlay' && !i ? 'none' : 'visible');
      map.setLayoutProperty('boundary-label', 'visibility', state.labels ? 'visible' : 'none');
      map.setFilter('boundary-highlight', ['==', ['get', 'displayName'], '']);
      highlightedNames[i] = null;
      map.getCanvas().style.cursor = '';
      for (const kind of ['added', 'removed', 'retained']) setSourceData(map, `change-${kind}`, i && changes ? changes[kind] || empty : empty);
    }
    $('electorates').replaceChildren(...electorateNames.map((name) => new Option(name, name)));
    if (changes) {
      $('change-name').textContent = state.electorate;
      for (const kind of ['added', 'removed', 'retained']) {
        const area = changes.areas[kind];
        $(`${kind}-area`).textContent = `${area > 0 && area < 0.01 ? '<0.01' : area.toLocaleString('en-AU', { maximumFractionDigits: 2 })} km²`;
      }
      $('change-message').textContent = !changes.a ? 'Not present under this name in A. The B footprint is shown as added.' : !changes.b ? 'Not present under this name in B. The A footprint is shown as removed.' : !changes.added && !changes.removed ? 'No boundary changes for this electorate between these versions.' : '';
      $('change-legend').hidden = false;
      const features = [changes.a, changes.b].filter(Boolean);
      if (features.length) changeBounds = coordinatesBounds(features);
      if (fitChange) fitChangedElectorate();
    }
    $('search-feedback').textContent = '';
    clearInspection();
    $('map-status').hidden = true;
    updateURL();
  } catch (error) {
    if (version !== generation) return;
    $('map-status').classList.add('error');
    $('map-status').textContent = `${error.message} Choose a dataset again to retry.`;
  }
}

function clearInspection() {
  lastInspectionKey = '';
  $('inspection').replaceChildren();
  const title = document.createElement('p');
  title.className = 'eyebrow';
  title.textContent = 'Explore the map';
  const hint = document.createElement('p');
  hint.textContent = 'Hover or tap a location to compare electorates.';
  $('inspection').append(title, hint);
}

function changeElectorateAt(map, lngLat) {
  const point = map.project(lngLat);
  // Prefer A's electorate at the point, even in a neighbouring B addition.
  return map.queryRenderedFeatures(point, { layers: ['reference-hit'] })[0]?.properties.displayName
    || map.queryRenderedFeatures(point, { layers: ['boundary-fill'] })[0]?.properties.displayName;
}

function inspect(lngLat) {
  if (!ready) return;
  if (state.mode === 'change') {
    maps[1].getCanvas().style.cursor = changeElectorateAt(maps[1], lngLat) ? 'pointer' : '';
    return;
  }
  const primary = maps[1];
  const aMap = state.mode === 'swipe' ? maps[0] : primary;
  if (!aMap?.getLayer('boundary-fill')) return;
  const aLayer = state.mode === 'swipe' ? 'boundary-fill' : 'reference-hit';
  const results = [
    aMap.queryRenderedFeatures(aMap.project(lngLat), { layers: [aLayer] })[0]?.properties.displayName,
    primary.queryRenderedFeatures(primary.project(lngLat), { layers: ['boundary-fill'] })[0]?.properties.displayName,
  ];
  const key = JSON.stringify(results);
  if (key === lastInspectionKey) return;
  lastInspectionKey = key;
  $('inspection').replaceChildren();
  const title = document.createElement('p');
  title.className = 'eyebrow';
  title.textContent = 'Electorates at this location';
  $('inspection').append(title);
  results.forEach((nameAtPoint, i) => {
    if (maps[i]) highlightElectorate(maps[i], nameAtPoint || '', i);
    const dataset = datasetById(i ? state.right : state.left);
    const row = document.createElement('div');
    row.className = 'inspect-row';
    row.style.setProperty('--dataset-color', dataset.color);
    const label = document.createElement('span');
    label.textContent = `${i ? 'B' : 'A'} · ${dataset.short || dataset.label}`;
    const name = document.createElement('strong');
    name.textContent = results[i] || 'Outside mapped area';
    row.append(label, name);
    $('inspection').append(row);
  });
}

function highlightElectorate(map, name, index) {
  if (highlightedNames[index] === name) return;
  highlightedNames[index] = name;
  map.setFilter('boundary-highlight', ['==', ['get', 'displayName'], name]);
  if (state.mode === 'overlay' && index === 1) {
    map.setPaintProperty('boundary-fill', 'fill-opacity', name
      ? ['case', ['==', ['get', 'displayName'], name], 0.32, 0.14]
      : 0.14);
  }
}

function coordinatesBounds(features) {
  const bounds = new maplibregl.LngLatBounds();
  function visit(coordinates) {
    if (typeof coordinates[0] === 'number') bounds.extend(coordinates.slice(0, 2));
    else coordinates.forEach(visit);
  }
  features.forEach((feature) => visit(feature.geometry.coordinates));
  return bounds;
}

function fitChangedElectorate() {
  if (!changeBounds) return;
  maps[1].fitBounds(changeBounds, { padding: { top: 110, bottom: 210, left: 30, right: 40 }, maxZoom: 12, duration: 700 });
}

function selectElectorate(name) {
  if (!electorateNames.includes(name)) return;
  state.electorate = name;
  render({ fitChange: true });
}

async function searchElectorate(event) {
  event.preventDefault();
  const query = $('search').value.trim().toLowerCase();
  if (!query) return;
  try {
    const selected = await Promise.all([loadDataset(state.left), loadDataset(state.right)]);
    const features = selected.flatMap((data) => data.features).filter((feature) => feature.properties.displayName.toLowerCase() === query);
    if (!features.length) {
      $('search-feedback').textContent = 'No matching electorate in these two maps. Try a name from the suggestions.';
      return;
    }
    $('search-feedback').textContent = '';
    maps[1].fitBounds(coordinatesBounds(features), { padding: { top: 75, bottom: 150, left: 40, right: 40 }, maxZoom: 12, duration: 700 });
    maps.forEach((map, index) => highlightElectorate(map, features[0].properties.displayName, index));
  } catch (error) {
    $('search-feedback').textContent = error.message;
  }
}

function setSplit(value) {
  state.split = Math.max(0, Math.min(100, value));
  updateDivider();
  scheduleURLUpdate();
}

function setupProjectControls() {
  document.title = `${project.label} · Boundary Explorer`;
  document.querySelector('meta[name="description"]').content = project.description || `Compare electoral boundaries for ${project.label}.`;
  $('project-subtitle').textContent = project.subtitle || project.label;
  $('project-stage').textContent = project.stage || '';
  $('stage').hidden = !project.stage;
  $('project-select').replaceChildren(...PROJECTS.map((entry) => new Option(entry.label, entry.id)));
  $('project-select').value = project.id;
  // Browsers can restore the selector's last form value after Back/Forward,
  // which was the destination chosen just before leaving this document.
  window.addEventListener('pageshow', () => {
    setTimeout(() => { $('project-select').value = project.id; }, 0);
  });
  $('project-select').addEventListener('change', () => {
    // A navigation gives each project a clean view and native back/forward support.
    location.assign(projectURL(location.href, $('project-select').value, { resetView: true }));
  });
  if (requestedProject && requestedProject !== project.id) {
    $('project-notice').hidden = false;
    $('project-notice').textContent = `Project “${requestedProject}” is not available. Showing ${project.label}.`;
  }
  $('availability').textContent = DATASETS.filter((dataset) => !dataset.path).map((dataset) => `${dataset.short || dataset.label}: ${dataset.description || 'Coming soon'}`).join(' · ');
  $('availability').hidden = !$('availability').textContent;
  $('search').placeholder = project.defaults?.electorate ? `e.g. ${project.defaults.electorate}` : 'Electorate name';
  $('baseline-option').hidden = !baselineDataset;
  $('baseline-text').textContent = baselineDataset ? `${baselineDataset.label} as dashed lines` : '';
  $('about-project').replaceChildren(...(project.about || []).map((text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  }));
  const views = [project.map.overview, ...(project.map.views || [])];
  const goTo = (view) => maps[1]?.fitBounds(view.bounds, { padding: 50, duration: 700 });
  $('region-views').replaceChildren(...views.map((view) => {
    const button = document.createElement('button');
    button.textContent = view.label;
    button.addEventListener('click', () => goTo(view));
    return button;
  }));
  $('reset-view').setAttribute('aria-label', project.map.overview.label);
  $('reset-view').title = project.map.overview.label;
  $('reset-view').addEventListener('click', () => goTo(project.map.overview));
}

function setupControls() {
  setupProjectControls();
  for (const side of ['left', 'right']) {
    const group = $(`${side}-dataset`);
    datasetsForSide(project, side).forEach((dataset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = dataset.buttonLabel || dataset.short || dataset.label;
      button.dataset.dataset = dataset.id;
      button.style.setProperty('--button-color', dataset.color);
      button.disabled = !dataset.path;
      button.title = `${dataset.label}${dataset.path ? '' : ' — map coming soon'}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => { state[side] = dataset.id; render({ fitChange: true }); });
      group.append(button);
    });
  }
  $('swap').addEventListener('click', () => { [state.left, state.right] = [state.right, state.left]; render({ fitChange: true }); });
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; render({ fitChange: true }); }));
  $('change-electorate').addEventListener('change', () => selectElectorate($('change-electorate').value));
  $('previous-electorate').addEventListener('click', () => selectElectorate(electorateNames[electorateNames.indexOf(state.electorate) - 1]));
  $('next-electorate').addEventListener('click', () => selectElectorate(electorateNames[electorateNames.indexOf(state.electorate) + 1]));
  $('fit-electorate').addEventListener('click', fitChangedElectorate);
  for (const key of ['labels', 'baseline']) $(key).addEventListener('change', () => { state[key] = $(key).checked; render(); });
  const handle = $('divider-handle');
  const moveDivider = (event) => {
    const rect = $('map-stage').getBoundingClientRect();
    setSplit((event.clientX - rect.left) / rect.width * 100);
  };
  handle.addEventListener('pointerdown', (event) => { handle.setPointerCapture(event.pointerId); moveDivider(event); });
  handle.addEventListener('pointermove', (event) => { if (handle.hasPointerCapture(event.pointerId)) moveDivider(event); });
  handle.addEventListener('pointerup', (event) => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); updateURL(); });
  handle.addEventListener('keydown', (event) => {
    const values = { ArrowLeft: state.split - 2, ArrowRight: state.split + 2, Home: 0, End: 100 };
    if (event.key in values) { event.preventDefault(); setSplit(values[event.key]); }
  });
  $('search-form').addEventListener('submit', searchElectorate);
  $('zoom-in').addEventListener('click', () => maps[1]?.zoomIn());
  $('zoom-out').addEventListener('click', () => maps[1]?.zoomOut());
  $('share').addEventListener('click', async () => {
    updateURL();
    try {
      await navigator.clipboard.writeText(location.href);
      $('toast').textContent = 'Comparison link copied';
    } catch {
      $('toast').textContent = 'Copy the URL from your address bar to share this view.';
    }
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
  });
  updateControls();
}

function createMap(side, camera) {
  const options = {
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [boundedNumber('lng', project.map.center[0], -180, 180), boundedNumber('lat', project.map.center[1], -85, 85)],
    zoom: boundedNumber('z', project.map.zoom, 3, 16), minZoom: 3, maxZoom: 16,
    attributionControl: false, pitchWithRotate: false, dragRotate: false,
    // A DPR-3 phone otherwise shades nine pixels per CSS pixel on each map.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    ...camera,
  };
  const map = new maplibregl.Map({ ...options, container: `map-${side}` });
  map.touchZoomRotate.disableRotation();
  maps[side === 'left' ? 0 : 1] = map;
  map.on('error', (event) => {
    console.error('Map resource error:', event.error);
    $('map-status').hidden = false;
    $('map-status').classList.add('error');
    $('map-status').textContent = 'A map resource could not load. Check your internet connection and reload.';
  });
  map.on('move', () => {
    if (syncing || state.mode !== 'swipe') return;
    syncing = true;
    maps.forEach((other) => { if (other !== map) other.jumpTo({ center: map.getCenter(), zoom: map.getZoom(), bearing: 0, pitch: 0 }); });
    syncing = false;
  });
  // jumpTo on the synced map emits moveend on every animation frame.
  // Never write browser history for those events (Safari rate-limits it).
  map.on('moveend', () => { if (!syncing) scheduleURLUpdate(); });
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    map.on('mousemove', (event) => {
      if (map.isMoving()) return;
      cancelAnimationFrame(inspectionFrame);
      inspectionFrame = requestAnimationFrame(() => inspect(event.lngLat));
    });
  }
  map.on('click', (event) => {
    if (!ready) return;
    if (state.mode === 'change') {
      const name = changeElectorateAt(map, event.lngLat);
      if (name && name !== state.electorate) selectElectorate(name);
    } else inspect(event.lngLat);
  });
  if (side === 'right') map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
  return new Promise((resolve) => {
    map.once('load', () => { addLayers(map); resolve(map); });
    // A rapid mode switch can remove a comparison before its style loads.
    map.once('remove', () => resolve(null));
  });
}

async function init() {
  PROJECTS.forEach(validateProject);
  setupControls();
  if (!window.maplibregl) throw new Error('The MapLibre library could not load. Check your connection and reload.');
  await createMap('right');
  let resizeFrame;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => maps.forEach((map) => map.resize()));
  }).observe($('map-stage'));
  ready = true;
  await render({ fitChange: !params.has('lng') });
}

init().catch((error) => {
  $('map-status').hidden = false;
  $('map-status').classList.add('error');
  $('map-status').textContent = error.message;
  console.error(error);
});

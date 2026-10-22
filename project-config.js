export function datasetsForSide(project, side, { availableOnly = false } = {}) {
  return project.datasets.filter((dataset) => (!dataset.sides || dataset.sides.includes(side))
    && (availableOnly ? dataset.path : dataset.path || !dataset.hideWhenUnavailable));
}

export function validateProject(project) {
  if (!project.id || !project.label) throw new Error('Every project needs an id and label.');
  if (!project.datasets?.length) throw new Error(`${project.id}: no boundary datasets configured.`);
  const ids = new Set();
  for (const dataset of project.datasets) {
    if (!dataset.id || !dataset.label || !dataset.color || ids.has(dataset.id)) throw new Error(`${project.id}: datasets need unique ids, labels and colours.`);
    if (dataset.sides && (!dataset.sides.length || dataset.sides.some((side) => !['left', 'right'].includes(side)))) throw new Error(`${project.id}: invalid sides for ${dataset.id}.`);
    ids.add(dataset.id);
  }
  for (const side of ['left', 'right']) {
    if (!datasetsForSide(project, side, { availableOnly: true }).length) throw new Error(`${project.id}: no available dataset for ${side}.`);
  }
  if (project.baselineDataset && !project.datasets.some((dataset) => dataset.id === project.baselineDataset && dataset.path)) throw new Error(`${project.id}: baseline dataset is unavailable.`);
  if (!Array.isArray(project.map?.center) || project.map.center.length !== 2 || !project.map.center.every(Number.isFinite)
    || !Number.isFinite(project.map.zoom) || !project.map.overview?.bounds) throw new Error(`${project.id}: configure a map center, zoom and overview bounds.`);
  return project;
}

export function initialState(project, params) {
  const defaults = project.defaults || {};
  const choose = (side, key) => {
    const datasets = datasetsForSide(project, side, { availableOnly: true });
    return (datasets.find((dataset) => dataset.id === params.get(key))
      || datasets.find((dataset) => dataset.id === defaults[side]) || datasets[0]).id;
  };
  const mode = params.get('mode') || defaults.mode;
  const split = params.has('split') ? Number(params.get('split')) : 50;
  return {
    left: choose('left', 'a'), right: choose('right', 'b'),
    mode: ['overlay', 'change', 'swipe'].includes(mode) ? mode : 'overlay',
    electorate: params.get('electorate') || defaults.electorate || '',
    split: Number.isFinite(split) && split >= 0 && split <= 100 ? split : 50,
    labels: params.get('labels') !== '0',
    baseline: Boolean(project.baselineDataset) && params.get('baseline') === '1',
  };
}

export function displayName(name) {
  const text = String(name).replaceAll('_', ' ').trim();
  // Preserve supplied mixed-case names; format all-caps/all-lowercase exports.
  return text === text.toUpperCase() || text === text.toLowerCase()
    ? text.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).replace(/\bMc(\p{L})/gu, (_, letter) => `Mc${letter.toUpperCase()}`)
    : text.replace(/\bMc(\p{L})/gu, (_, letter) => `Mc${letter.toUpperCase()}`);
}

export function normalizeDataset(data, project, dataset) {
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`Invalid GeoJSON: ${dataset.label}`);
  const nameProperty = dataset.nameProperty || project.nameProperty || 'name';
  return { ...data, features: data.features.map((feature, index) => {
    const rawName = feature.properties?.[nameProperty];
    if (typeof rawName !== 'string' || !rawName.trim()) throw new Error(`${dataset.label}: feature ${index + 1} is missing a ${nameProperty} name.`);
    if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) throw new Error(`${dataset.label}: feature ${index + 1} must be a Polygon or MultiPolygon.`);
    const name = displayName(rawName);
    const canonicalName = dataset.nameAliases?.[name] || project.nameAliases?.[name] || name;
    return { ...feature, properties: { ...feature.properties, displayName: canonicalName } };
  }) };
}

export function projectURL(href, id, { resetView = false } = {}) {
  const url = new URL(href);
  url.searchParams.set('project', id);
  if (resetView) url.hash = '';
  return url;
}

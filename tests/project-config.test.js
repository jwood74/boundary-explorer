import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetsForSide, initialState, normalizeDataset, projectURL, validateProject } from '../project-config.js';
import { PROJECTS, DEFAULT_PROJECT_ID } from '../projects.js';

// Deliberately uses no Queensland names, party ids or mandatory Current dataset.
const project = {
  id: 'example', label: 'Example project', nameProperty: 'division',
  defaults: { left: 'existing', right: 'draft', electorate: 'North', mode: 'overlay' },
  map: { center: [146, -42], zoom: 7, overview: { label: 'Overview', bounds: [[144, -44], [149, -40]] } },
  datasets: [
    { id: 'existing', label: 'Existing', color: '#666666', path: 'existing.geojson', sides: ['left'] },
    { id: 'draft', label: 'Draft', color: '#2266aa', path: 'draft.geojson' },
    { id: 'final', label: 'Final', color: '#228855', path: null, hideWhenUnavailable: true },
    { id: 'other', label: 'Other', color: '#aa2222', path: null },
  ],
};
const feature = (properties) => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
const collection = (properties) => ({ type: 'FeatureCollection', features: [feature(properties)] });

test('all registered projects are valid and the default exists', () => {
  assert.ok(PROJECTS.some((entry) => entry.id === DEFAULT_PROJECT_ID));
  assert.equal(new Set(PROJECTS.map((entry) => entry.id)).size, PROJECTS.length);
  PROJECTS.forEach(validateProject);
});

test('dataset eligibility and visibility come from configuration', () => {
  assert.deepEqual(datasetsForSide(project, 'left').map((entry) => entry.id), ['existing', 'draft', 'other']);
  assert.deepEqual(datasetsForSide(project, 'right').map((entry) => entry.id), ['draft', 'other']);
  assert.deepEqual(datasetsForSide(project, 'right', { availableOnly: true }).map((entry) => entry.id), ['draft']);
});

test('project defaults do not depend on specific dataset ids or electorate names', () => {
  validateProject(project);
  const state = initialState(project, new URLSearchParams());
  assert.equal(state.left, 'existing');
  assert.equal(state.right, 'draft');
  assert.equal(state.electorate, 'North');
  assert.equal(state.mode, 'overlay');
});

test('shared views retain valid state and reject unavailable or disallowed versions', () => {
  const state = initialState(project, new URLSearchParams('a=draft&b=existing&mode=change&electorate=South&split=32&labels=0&baseline=1'));
  assert.equal(state.left, 'draft');
  assert.equal(state.right, 'draft');
  assert.equal(state.mode, 'change');
  assert.equal(state.electorate, 'South');
  assert.equal(state.split, 32);
  assert.equal(state.labels, false);
  assert.equal(state.baseline, false);
  const fallback = initialState(project, new URLSearchParams('a=other&b=unknown&split=NaN&mode=unknown'));
  assert.equal(fallback.left, 'existing');
  assert.equal(fallback.right, 'draft');
  assert.equal(fallback.split, 50);
  assert.equal(fallback.mode, 'swipe');
});

test('normalisation uses project fields and preserves original source data', () => {
  const original = collection({ division: 'WIDE_BAY' });
  const normalised = normalizeDataset(original, project, project.datasets[0]);
  assert.equal(normalised.features[0].properties.displayName, 'Wide Bay');
  assert.equal(original.features[0].properties.displayName, undefined);
  assert.equal(normalised.features[0].properties.division, 'WIDE_BAY');
});

test('dataset field overrides and explicit name mappings support different exports', () => {
  const dataset = { ...project.datasets[1], nameProperty: 'NAME', nameAliases: { 'Old Division': 'New Division' } };
  assert.equal(normalizeDataset(collection({ NAME: 'OLD_DIVISION' }), project, dataset).features[0].properties.displayName, 'New Division');
  assert.equal(normalizeDataset(collection({ division: 'Mcpherson' }), project, project.datasets[0]).features[0].properties.displayName, 'McPherson');
  assert.equal(normalizeDataset(collection({ division: 'MCPHERSON' }), project, project.datasets[0]).features[0].properties.displayName, 'McPherson');
});

test('invalid names and non-polygon data fail with actionable messages', () => {
  assert.throws(() => normalizeDataset(collection({ wrong: 'North' }), project, project.datasets[0]), /missing a division name/);
  const points = collection({ division: 'North' });
  points.features[0].geometry.type = 'Point';
  assert.throws(() => normalizeDataset(points, project, project.datasets[0]), /Polygon or MultiPolygon/);
});

test('project URLs work below a GitHub Pages repository path', () => {
  const href = 'https://example.github.io/boundary-explorer/?source=link#a=existing&b=draft';
  const switched = projectURL(href, 'second-project', { resetView: true });
  assert.equal(switched.pathname, '/boundary-explorer/');
  assert.equal(switched.searchParams.get('project'), 'second-project');
  assert.equal(switched.searchParams.get('source'), 'link');
  assert.equal(switched.hash, '');
  assert.equal(projectURL(href, 'example').hash, '#a=existing&b=draft');
});

test('project validation rejects missing available sides and invalid baselines', () => {
  assert.throws(() => validateProject({ ...project, datasets: [{ ...project.datasets[0], sides: ['left'] }] }), /no available dataset for right/);
  assert.throws(() => validateProject({ ...project, baselineDataset: 'missing' }), /baseline dataset is unavailable/);
  assert.throws(() => validateProject({ ...project, datasets: [project.datasets[1], project.datasets[1]] }), /unique ids/);
});

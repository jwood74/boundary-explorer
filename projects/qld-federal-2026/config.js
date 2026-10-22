// Paths are resolved relative to this file, including on GitHub Pages.
const dataPath = (name) => new URL(`../../data/${name}.geojson`, import.meta.url).href;

export default {
  id: 'qld-federal-2026',
  label: 'Queensland · Federal · 2026',
  subtitle: 'Federal redistribution · 2026',
  stage: 'Suggestions stage',
  description: 'Explore and compare suggested federal electoral boundaries for Queensland’s 2026 redistribution.',
  electorateLabel: 'federal electorates',
  nameProperty: 'name',
  baselineDataset: 'current',
  defaults: { left: 'current', right: 'lnp', electorate: 'Griffith', mode: 'overlay' },
  map: {
    center: [152.95, -27.4],
    zoom: 8.5,
    overview: { label: 'All Queensland', bounds: [[137.8, -29.3], [154, -9.5]] },
    views: [
      { label: 'South East Qld', bounds: [[151.5, -28.5], [153.6, -26.1]] },
      { label: 'Brisbane', bounds: [[152.65, -27.8], [153.4, -27.1]] },
    ],
  },
  about: [
    'These are party suggestions, not the Redistribution Committee’s proposed boundaries. Colours identify the submission, not the party holding an electorate.',
    'Boundary files supplied for this project. Electorate names are standardised for comparison. No voting or enrolment data is inferred.',
  ],
  datasets: [
    { id: 'current', label: 'Current boundaries', short: 'Current', description: 'Existing federal electoral divisions', color: '#666b70', path: dataPath('current'), sides: ['left'] },
    { id: 'alp', label: 'ALP suggestion', short: 'ALP', description: 'Map coming soon', color: '#ba3b47', path: null },
    { id: 'lnp', label: 'LNP suggestion', short: 'LNP', description: 'Liberal National Party submission', color: '#2161a6', path: dataPath('lnp') },
    { id: 'grn', label: 'Greens suggestion', short: 'Greens', buttonLabel: 'GRN', description: 'Queensland Greens submission', color: '#28794a', path: dataPath('grn') },
    { id: 'proposed', label: 'Official proposal', short: 'Proposal', description: 'Not yet published', color: '#b36b16', path: null, hideWhenUnavailable: true },
  ],
};

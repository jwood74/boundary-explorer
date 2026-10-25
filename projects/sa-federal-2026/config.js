// Paths are resolved relative to this file, including on GitHub Pages.
const dataPath = (year) => new URL(`../../data/sa_${year}.geojson`, import.meta.url).href;

export default {
  id: 'sa-federal-2026',
  label: 'South Australia · Federal · 2026',
  subtitle: 'Federal boundaries · 2018–2026',
  stage: '2018–2026 comparison',
  description: 'Explore and compare South Australia’s 2018 and 2026 federal electoral boundaries.',
  electorateLabel: 'federal electorates',
  nameProperty: 'name',
  baselineDataset: '2018',
  defaults: { left: '2018', right: '2026', electorate: 'Adelaide', mode: 'overlay' },
  map: {
    center: [138.6, -34.95],
    zoom: 9,
    overview: { label: 'All South Australia', bounds: [[129, -38.1], [141.1, -25.9]] },
    views: [
      { label: 'Greater Adelaide', bounds: [[138.2, -35.5], [139.1, -34.4]] },
      { label: 'Adelaide', bounds: [[138.45, -35.1], [138.8, -34.7]] },
    ],
  },
  about: [
    'Compare the supplied 2018 and 2026 federal boundary files. Colours identify the boundary version, not the party holding an electorate.',
    'Grey (2018) is linked to its new name, O’Donoghue (2026), for comparison. Each map keeps its original electorate names. No voting or enrolment data is inferred.',
  ],
  datasets: [
    { id: '2018', label: '2018 boundaries', short: '2018', description: 'Old federal electoral boundaries', color: '#666b70', path: dataPath('2018'), nameAliases: { Grey: "O'Donoghue" } },
    { id: '2026', label: '2026 boundaries', short: '2026', description: 'New federal electoral boundaries', color: '#2161a6', path: dataPath('2026') },
  ],
};

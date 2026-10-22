// Exact polygon differences; no snapping or simplification of supplied boundaries.
// Match names, rather than feature order (which differs between submissions).
export function compareElectorate(left, right, name) {
  const turf = globalThis.turf;
  if (!turf) throw new Error('The geometry library could not load. Check your connection and reload to use Change mode.');
  const matches = (data) => data.features.filter((feature) => feature.properties.displayName === name);
  const merge = (features) => features.length > 1 ? turf.union(turf.featureCollection(features)) : features[0] || null;
  const a = merge(matches(left));
  const b = merge(matches(right));
  const identical = a && a === b;
  const pair = a && b ? turf.featureCollection([a, b]) : null;
  const removed = identical ? null : pair ? turf.difference(pair) : a;
  const added = identical ? null : pair ? turf.difference(turf.featureCollection([b, a])) : b;
  const retained = identical ? a : pair ? turf.intersect(pair) : null;
  return {
    a, b, added, removed, retained,
    areas: Object.fromEntries(Object.entries({ added, removed, retained }).map(([key, feature]) => [key, feature ? turf.area(feature) / 1e6 : 0])),
  };
}

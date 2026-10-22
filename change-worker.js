import 'https://unpkg.com/@turf/turf@7.2.0/turf.min.js';
const changesURL = new URL('./changes.js', import.meta.url);
changesURL.search = new URL(import.meta.url).search;
let comparisonModule;

// Install the message handler before awaiting dynamic imports. WebKit can
// dispatch the first request while a worker's top-level await is suspended.
self.onmessage = async ({ data: { id, left, right, name } }) => {
  try {
    comparisonModule ||= import(changesURL.href);
    const { compareElectorate } = await comparisonModule;
    self.postMessage({ id, result: compareElectorate(left, right, name) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

// The client waits for this handshake instead of racing module startup.
self.postMessage({ type: 'ready' });

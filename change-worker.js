import 'https://unpkg.com/@turf/turf@7.2.0/turf.min.js';
import { compareElectorate } from './changes.js';

self.onmessage = ({ data: { id, left, right, name } }) => {
  try {
    self.postMessage({ id, result: compareElectorate(left, right, name) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

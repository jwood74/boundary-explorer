// Keep polygon clipping off the UI thread. Only send the selected electorate,
// rather than cloning both complete statewide datasets for every calculation.
export class ChangeCalculator {
  constructor(createWorker = () => new Worker(new URL('./change-worker.js', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker;
    this.worker = null;
    this.pending = null;
    this.sequence = 0;
  }

  calculate(left, right, name) {
    this.cancel();
    if (!this.worker) {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if (!this.pending || data.id !== this.pending.id) return;
        const { resolve, reject } = this.pending;
        this.pending = null;
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = (event) => {
        if (this.worker !== worker) return;
        event.preventDefault?.();
        const pending = this.pending;
        this.pending = null;
        worker.terminate();
        this.worker = null;
        pending?.reject(new Error('The background geometry worker could not load. Check your connection and try Change again.'));
      };
    }
    const id = ++this.sequence;
    const selected = (data) => ({ type: 'FeatureCollection', features: data.features.filter((feature) => feature.properties.displayName === name) });
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      try {
        this.worker.postMessage({ id, left: selected(left), right: selected(right), name });
      } catch (error) {
        this.pending = null;
        this.worker.terminate();
        this.worker = null;
        reject(error);
      }
    });
  }

  cancel() {
    if (!this.pending) return;
    const { reject } = this.pending;
    this.pending = null;
    this.worker.terminate();
    this.worker = null;
    reject(new DOMException('Boundary calculation superseded.', 'AbortError'));
  }
}

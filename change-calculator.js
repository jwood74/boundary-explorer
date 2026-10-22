// Keep polygon clipping off the UI thread. Only send the selected electorate,
// rather than cloning both complete statewide datasets for every calculation.
export function createChangeWorker() {
  const url = new URL('./change-worker.js', import.meta.url);
  url.search = new URL(import.meta.url).search;
  return new Worker(url, { type: 'module' });
}

export class ChangeCalculator {
  constructor(createWorker = createChangeWorker) {
    this.createWorker = createWorker;
    this.worker = null;
    this.workerReady = false;
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
        if (data.type === 'ready') {
          this.workerReady = true;
          if (this.pending) this.sendPending();
          return;
        }
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
        this.workerReady = false;
        pending?.reject(new Error('The background geometry worker could not load. Check your connection and try Change again.'));
      };
    }
    const id = ++this.sequence;
    const selected = (data) => ({ type: 'FeatureCollection', features: data.features.filter((feature) => feature.properties.displayName === name) });
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, message: { id, left: selected(left), right: selected(right), name } };
      // Safari must not receive the first job before the worker is listening.
      if (this.workerReady) this.sendPending();
    });
  }

  sendPending() {
    try {
      this.worker.postMessage(this.pending.message);
    } catch (error) {
      const { reject } = this.pending;
      this.pending = null;
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
      reject(error);
    }
  }

  cancel() {
    if (!this.pending) return;
    const { reject } = this.pending;
    this.pending = null;
    this.worker.terminate();
    this.worker = null;
    this.workerReady = false;
    reject(new DOMException('Boundary calculation superseded.', 'AbortError'));
  }
}

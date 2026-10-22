import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeCalculator } from '../change-calculator.js';

function setup({ ready = true } = {}) {
  const workers = [];
  const calculator = new ChangeCalculator(() => {
    const worker = {
      messages: [], terminated: false,
      set onmessage(handler) { this.handler = handler; if (ready) this.announceReady(); },
      get onmessage() { return this.handler; },
      announceReady() { this.onmessage({ data: { type: 'ready' } }); },
      postMessage(message) { this.messages.push(message); },
      terminate() { this.terminated = true; },
      reply(result) { this.onmessage({ data: { id: this.messages.at(-1).id, result } }); },
    };
    workers.push(worker);
    return worker;
  });
  return { calculator, workers };
}
const feature = (name) => ({ type: 'Feature', properties: { displayName: name }, geometry: null });
const data = { type: 'FeatureCollection', features: [feature('North'), feature('South')] };

test('sends only the selected electorate to the background worker', async () => {
  const { calculator, workers } = setup();
  const pending = calculator.calculate(data, data, 'North');
  assert.equal(workers[0].messages[0].left.features.length, 1);
  assert.equal(workers[0].messages[0].right.features[0].properties.displayName, 'North');
  workers[0].reply({ areas: { added: 1 } });
  assert.deepEqual(await pending, { areas: { added: 1 } });
});

test('reuses an idle worker instead of reloading the geometry library', async () => {
  const { calculator, workers } = setup();
  const first = calculator.calculate(data, data, 'North');
  workers[0].reply('first');
  await first;
  const next = calculator.calculate(data, data, 'South');
  assert.equal(workers.length, 1);
  assert.equal(workers[0].terminated, false);
  workers[0].reply('second');
  assert.equal(await next, 'second');
});

test('the first request waits for the worker readiness handshake', async () => {
  const { calculator, workers } = setup({ ready: false });
  const pending = calculator.calculate(data, data, 'North');
  assert.equal(workers[0].messages.length, 0);
  workers[0].announceReady();
  assert.equal(workers[0].messages.length, 1);
  workers[0].reply('first request delivered');
  assert.equal(await pending, 'first request delivered');
});

test('cancelling a starting worker cannot send an obsolete request after readiness', async () => {
  const { calculator, workers } = setup({ ready: false });
  const first = calculator.calculate(data, data, 'North');
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  const next = calculator.calculate(data, data, 'South');
  await cancelled;
  workers[0].announceReady();
  assert.equal(workers[0].messages.length, 0);
  assert.equal(workers[1].messages.length, 0);
  workers[1].announceReady();
  assert.equal(workers[1].messages[0].name, 'South');
  workers[1].reply('latest request delivered');
  assert.equal(await next, 'latest request delivered');
});

test('a newer selection cancels busy clipping and ignores stale messages', async () => {
  const { calculator, workers } = setup();
  const first = calculator.calculate(data, data, 'North');
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  const next = calculator.calculate(data, data, 'South');
  await cancelled;
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  workers[0].reply('stale result');
  workers[0].onerror({});
  assert.equal(workers[1].terminated, false);
  workers[1].reply('latest result');
  assert.equal(await next, 'latest result');
});

test('leaving Change cancels pending work, but does not terminate idle workers', async () => {
  const { calculator, workers } = setup();
  const first = calculator.calculate(data, data, 'North');
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  calculator.cancel();
  await cancelled;
  assert.equal(workers[0].terminated, true);
  const next = calculator.calculate(data, data, 'South');
  workers[1].reply('done');
  await next;
  calculator.cancel();
  assert.equal(workers[1].terminated, false);
});

test('worker startup failures are reported and can be retried', async () => {
  const { calculator, workers } = setup();
  const pending = calculator.calculate(data, data, 'North');
  const failure = assert.rejects(pending, /background geometry worker could not load/);
  workers[0].onerror({ preventDefault() {} });
  await failure;
  const retry = calculator.calculate(data, data, 'North');
  workers[1].reply('recovered');
  assert.equal(await retry, 'recovered');
});

test('clipping errors reject the request without losing a reusable worker', async () => {
  const { calculator, workers } = setup();
  const pending = calculator.calculate(data, data, 'North');
  const failure = assert.rejects(pending, /Invalid polygon/);
  workers[0].onmessage({ data: { id: workers[0].messages[0].id, error: 'Invalid polygon' } });
  await failure;
  const retry = calculator.calculate(data, data, 'South');
  workers[0].reply('valid result');
  assert.equal(await retry, 'valid result');
  assert.equal(workers.length, 1);
});

test('a failed message transfer cleans up the pending worker', async () => {
  const { calculator, workers } = setup();
  const first = calculator.calculate(data, data, 'North');
  workers[0].reply('ready');
  await first;
  workers[0].postMessage = () => { throw new Error('Transfer failed'); };
  await assert.rejects(calculator.calculate(data, data, 'South'), /Transfer failed/);
  assert.equal(workers[0].terminated, true);
  assert.equal(calculator.pending, null);
  assert.equal(calculator.worker, null);
});

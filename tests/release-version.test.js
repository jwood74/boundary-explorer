import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the HTML gives the entry module and stylesheet the same release version', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = html.match(/src="app\.js\?v=([^"&]+)"/);
  const style = html.match(/href="style\.css\?v=([^"&]+)"/);
  assert.ok(app, 'Entry module must have a release version to avoid stale browser caches.');
  assert.ok(style, 'Stylesheet must have a release version.');
  assert.equal(app[1], style[1]);
});

test('a versioned registry loads project configuration under the same version', async () => {
  const { PROJECTS } = await import('../projects.js?v=cache-regression');
  const { default: config } = await import('../projects/qld-federal-2026/config.js?v=cache-regression');
  assert.equal(PROJECTS[0], config, 'Registry must not silently reuse unversioned cached configuration.');
});

test('the geometry worker inherits the calculator module release version', async () => {
  const { createChangeWorker } = await import('../change-calculator.js?v=cache-regression');
  const original = globalThis.Worker;
  let requested;
  globalThis.Worker = class {
    constructor(url, options) { requested = { url, options }; }
  };
  try {
    createChangeWorker();
    assert.equal(requested.url.searchParams.get('v'), 'cache-regression');
    assert.ok(requested.url.pathname.endsWith('/change-worker.js'));
    assert.equal(requested.options.type, 'module');
  } finally {
    if (original === undefined) delete globalThis.Worker;
    else globalThis.Worker = original;
  }
});

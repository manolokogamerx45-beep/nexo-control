const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server.cjs');
const ORIGIN = 'http://127.0.0.1:4173';
const dist = file => fs.readFileSync(path.join(__dirname, '..', 'dist', file), 'utf8');

test('web app is installable: manifest, icons, worker and offline page are served', async t => {
  const app = createApp({ database: { memory: true }, origin: ORIGIN, googleClientId: '', googleClientSecret: '' });
  await app.ready;
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await app.closed; });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const manifestResponse = await fetch(base + '/manifest.webmanifest');
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /^application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  for (const size of ['192x192', '512x512'])
    assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.purpose === 'any'), size);
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of [...manifest.icons.map(icon => icon.src), '/icons/apple-touch-icon.png']) {
    const response = await fetch(base + icon);
    assert.equal(response.status, 200, icon);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).slice(0, 4)], [137, 80, 78, 71]);
  }
  const worker = await fetch(base + '/sw.js');
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /^text\/javascript/);
  const offline = await fetch(base + '/offline.html');
  assert.equal(offline.status, 200);
  assert.match(await offline.text(), /Sin conexión/);
  assert.match(dist('index.html'), /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(dist('auth.js'), /serviceWorker\.register\('\/sw\.js'\)/);
});

test('service worker never caches inventory data or the protected bundle', () => {
  const worker = dist('sw.js');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\) \|\| url\.pathname === '\/app\.js'\) return;/);
  const shell = JSON.parse(worker.match(/const SHELL = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.ok(!shell.some(file => file.startsWith('/api/') || file === '/app.js'));
});

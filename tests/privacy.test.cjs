const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server.cjs');
const ORIGIN = 'http://127.0.0.1:4173';
const dist = file => fs.readFileSync(path.join(__dirname, '..', 'dist', file), 'utf8');

test('privacy notice is public and linked from the footer and the sign-in screen', async t => {
  const app = createApp({ database: { memory: true }, origin: ORIGIN, googleClientId: '', googleClientSecret: '' });
  await app.ready;
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await app.closed; });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  for (const route of ['/aviso-privacidad', '/aviso-privacidad.html']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(await response.text(), /Aviso de privacidad integral/);
  }
  assert.match(dist('index.html'), /<footer>[^]*href="\/aviso-privacidad"[^]*<\/footer>/);
  assert.match(dist('auth.js'), /auth-footer-note">[^<]*<a href="\/aviso-privacidad">/);
});

test('privacy notice covers every element the law requires', () => {
  const html = dist('aviso-privacidad.html');
  for (const heading of ['Identidad y domicilio del responsable', 'Datos personales que tratamos', 'Finalidades del tratamiento',
    'Cookies y tecnologías similares', 'Encargados y transferencias', 'Derechos ARCO', 'Revocación del consentimiento', 'Cambios a este aviso'])
    assert.ok(html.includes(heading), heading);
  assert.match(html, /Última actualización:/);
});

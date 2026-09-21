const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

test('missing Firebase credentials cannot crash the server during Google login', { timeout: 30000 }, async t => {
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', '-e', `
    const app = require('./server.cjs').createApp({
      database: { projectId: 'demo-nexo', keyFilename: 'missing-credential-for-regression.json' },
      googleClientId: 'test-client', googleClientSecret: 'test-secret'
    });
    app.server.listen(0, '127.0.0.1', () => console.log(app.server.address().port));
  `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, FIRESTORE_EMULATOR_HOST: '', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const [output] = await once(child.stdout, 'data');
  const base = 'http://127.0.0.1:' + Number(String(output).trim());
  const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...options });
  for (const route of ['/api/v1/auth/google', '/api/v1/auth/google/callback?code=x&state=y']) {
    const response = await request(route);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/?auth_error=service_unavailable');
  }
  const json = await request('/api/v1/auth/google', { headers: { Accept: 'application/json' } });
  assert.equal(json.status, 503);
  assert.match((await json.json()).error, /Firebase/);
  assert.equal((await request('/health/ready')).status, 503);
  assert.equal((await request('/health/live')).status, 200);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/auth.js')).status, 200);
  assert.equal(child.exitCode, null, stderr);
  assert.doesNotMatch(stderr, /UnhandledPromiseRejection|googleauth\.js/);
});

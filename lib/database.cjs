const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash, randomUUID } = require('node:crypto');
const keyOf = value => createHash('sha256').update(String(value)).digest('hex');
const copy = value => value === undefined ? undefined : structuredClone(value);

// Memory storage is explicitly selected by unit tests only.
function openDatabase(options = {}) {
  if (options === ':memory:') options = { memory: true };
  if (typeof options !== 'object') throw new Error('Configura Firebase con FIREBASE_PROJECT_ID.');
  if (options.memory && process.env.NODE_ENV === 'production') throw new Error('Producción requiere Firestore.');
  if (process.env.NODE_ENV === 'production' && process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Producción no permite el emulador Firestore.');
  const namespace = options.namespace || process.env.FIRESTORE_NAMESPACE || 'nexo';
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(namespace)) throw new Error('FIRESTORE_NAMESPACE inválido.');
  const context = new AsyncLocalStorage();
  const memory = options.memory ? new Map() : null;
  let client, auth, credentialCheck, queue = Promise.resolve();
  if (!memory) {
    const projectId = options.projectId || process.env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('Configura FIREBASE_PROJECT_ID para conectar Cloud Firestore.');
    const { Firestore } = require('@google-cloud/firestore');
    const { GoogleAuth } = require('google-auth-library');
    const keyFilename = options.keyFilename || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    auth = new GoogleAuth({ projectId, keyFilename, scopes: ['https://www.googleapis.com/auth/datastore'] });
    client = new Firestore({ projectId, keyFilename, databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)', preferRest: !process.env.FIRESTORE_EMULATOR_HOST });
  }
  async function checkCredentials() {
    if (memory || process.env.FIRESTORE_EMULATOR_HOST) return;
    // Check ADC before transport initialization, so credential failures reject
    // the request instead of becoming unhandled gRPC initialization errors.
    if (!credentialCheck) {
      credentialCheck = (async () => {
        let timer;
        try {
          await Promise.race([
            auth.getAccessToken(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Credential timeout')), 8000); })
          ]);
        } catch {
          throw Object.assign(new Error('No se pudo conectar con Firebase. Contacta al administrador para revisar la conexión del servidor.'), { status: 503 });
        } finally { clearTimeout(timer); }
      })();
    }
    try { await credentialCheck; } finally { credentialCheck = undefined; }
  }
  const pathOf = (collection, key) => `nexo/${namespace}/${collection}/${keyOf(key)}`;
  const serial = task => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
  async function get(collection, key) {
    const path = pathOf(collection, key), state = context.getStore();
    if (state?.writes.has(path)) return copy(state.writes.get(path)) || undefined;
    if (memory) return copy(memory.get(path));
    await checkCredentials();
    const ref = client.doc(path);
    const snap = state ? await state.tx.get(ref) : await ref.get();
    return snap.exists ? snap.data() : undefined;
  }
  async function list(collection, field, value) {
    const prefix = `nexo/${namespace}/${collection}/`, state = context.getStore();
    let rows;
    if (memory) rows = new Map([...memory].filter(([path]) => path.startsWith(prefix)));
    else {
      await checkCredentials();
      let query = client.collection(`nexo/${namespace}/${collection}`);
      if (field) query = query.where(field, '==', value);
      const snap = state ? await state.tx.get(query) : await query.get();
      rows = new Map(snap.docs.map(doc => [doc.ref.path, doc.data()]));
    }
    if (state) for (const [path, data] of state.writes) {
      if (path.startsWith(prefix)) data === null ? rows.delete(path) : rows.set(path, data);
    }
    return [...rows.values()].filter(row => !field || row[field] === value).map(copy);
  }
  async function write(collection, key, value) {
    const path = pathOf(collection, key), state = context.getStore();
    if (state) { state.writes.set(path, copy(value)); return; }
    if (memory) return serial(() => value === null ? memory.delete(path) : memory.set(path, copy(value)));
    await checkCredentials();
    if (value === null) await client.doc(path).delete(); else await client.doc(path).set(value);
  }
  async function transaction(fn, accessLock = false) {
    if (context.getStore()) return fn();
    if (memory) return serial(async () => {
      const state = { writes: new Map() };
      const result = await context.run(state, fn);
      for (const [path, value] of state.writes) value === null ? memory.delete(path) : memory.set(path, value);
      return result;
    });
    await checkCredentials();
    return client.runTransaction(async tx => {
      const state = { tx, writes: new Map() };
      return context.run(state, async () => {
        if (accessLock) {
          await get('metadata', 'access');
          await write('metadata', 'access', { revision: randomUUID() });
        }
        const result = await fn();
        // Stage writes so every Firestore read precedes the first write.
        // get/list overlay staged values for read-your-writes behavior.
        for (const [path, value] of state.writes) {
          if (value === null) tx.delete(client.doc(path)); else tx.set(client.doc(path), value);
        }
        return result;
      });
    }, { maxAttempts: 10 });
  }
  const db = {
    dialect: memory ? 'memory' : 'firestore',
    transaction: fn => transaction(() => fn(db), true),
    async health() { await get('metadata', 'health'); },
    async close() { if (client) await client.terminate(); else await queue; },
    getUser: id => get('users', id),
    async findUser(field, value) {
      const identity = await get('identities', `${field}:${value}`);
      return identity ? get('users', identity.user_id) : undefined;
    },
    async createUser(input) {
      return transaction(async () => {
        if (await db.findUser('email', input.email)) return undefined;
        if (input.google_sub && await db.findUser('google_sub', input.google_sub)) return undefined;
        if (await get('users', input.id)) throw new Error('ID de usuario duplicado.');
        const user = { password_hash: null, google_sub: null, department: '', phone: '',
          role: 'consulta', status: 'pending', last_login: null, session_version: 0, ...input };
        await write('users', user.id, user);
        await write('identities', `email:${user.email}`, { user_id: user.id });
        if (user.google_sub) await write('identities', `google_sub:${user.google_sub}`, { user_id: user.id });
        return user;
      });
    },
    async updateUser(id, patch) {
      return transaction(async () => {
        const user = await db.getUser(id);
        if (!user) throw new Error('Usuario no encontrado.');
        if (patch.email !== undefined || patch.id !== undefined) throw new Error('La identidad no puede modificarse.');
        if (patch.google_sub !== undefined && patch.google_sub !== user.google_sub) {
          if (patch.google_sub && await db.findUser('google_sub', patch.google_sub)) throw new Error('Identidad de Google duplicada.');
          if (user.google_sub) await write('identities', `google_sub:${user.google_sub}`, null);
          if (patch.google_sub) await write('identities', `google_sub:${patch.google_sub}`, { user_id: id });
        }
        await write('users', id, { ...user, ...patch });
      });
    },
    async listUsers() { return (await list('users')).sort((a,b) => b.created_at.localeCompare(a.created_at)); },
    async countAdmins() { return (await list('users','role','administrador')).filter(u => u.status === 'active').length; },
    getApproval: email => get('email_approvals', email),
    saveApproval: row => write('email_approvals', row.email, row),
    deleteApproval: email => write('email_approvals', email, null),
    async listApprovals() { return (await list('email_approvals')).sort((a,b) => b.created_at.localeCompare(a.created_at)); },
    saveAudit: row => write('audit', row.id, row),
    listAudit: action => list('audit', 'action', action),
    getSession: hash => get('sessions', hash),
    saveSession: row => write('sessions', row.token_hash, { ...row, delete_after: new Date(row.expires_at) }),
    deleteSession: hash => write('sessions', hash, null),
    async revokeSessions(userId) {
      return transaction(async () => {
        const user = await db.getUser(userId);
        await db.updateUser(userId, { session_version: (user.session_version || 0) + 1 });
      });
    },
    saveOAuth: row => write('oauth_states', row.state_hash, { ...row, delete_after: new Date(row.expires_at) }),
    async consumeOAuth(hash, binding, now) {
      return transaction(async () => {
        const state = await get('oauth_states', hash);
        if (!state || state.binding_hash !== binding || state.expires_at <= now) return undefined;
        await write('oauth_states', hash, null);
        return state;
      });
    },
    listOAuth: () => list('oauth_states'),
    saveRateLimit: row => write('rate_limits', row.key, { ...row, delete_after: new Date(row.expires_at) }),
    async incrementRate(key, limit, now, windowMs) {
      return transaction(async () => {
        const old = await get('rate_limits', key);
        const row = old && old.expires_at > now ? old : { key, count: 0, expires_at: now + windowMs };
        if (row.count >= limit) return false;
        await db.saveRateLimit({ ...row, count: row.count + 1 });
        return true;
      });
    }
  };
  db.ready = Promise.resolve();
  return db;
}
module.exports = { openDatabase };

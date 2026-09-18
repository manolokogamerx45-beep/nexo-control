const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, createHash, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const scrypt = promisify(scryptCallback);
const ROLES = ['administrador', 'compras', 'almacen', 'consulta'];
const STATUSES = ['pending', 'active', 'disabled'];
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const emailOf = value => String(value || '').trim().toLowerCase();
function bad(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function validateEmail(value) {
  const email = emailOf(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Escribe un correo electrónico válido.');
  return email;
}
function validateName(value) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 80) bad('El nombre debe tener entre 2 y 80 caracteres.');
  return value.trim();
}
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) bad('La contraseña debe tener entre 12 y 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, hash] = (stored || '00000000000000000000000000000000:' + '00'.repeat(64)).split(':');
  const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex')) && !!stored;
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, department: u.department, phone: u.phone,
    role: u.role, status: u.status, provider: u.google_sub ? 'google' : 'password',
    createdAt: u.created_at, lastLogin: u.last_login };
}
function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT, google_sub TEXT UNIQUE, department TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'consulta'
        CHECK(role IN ('administrador','compras','almacen','consulta')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','disabled')),
      created_at TEXT NOT NULL, last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_approvals (
      email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('administrador','compras','almacen','consulta')),
      approved_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, nonce TEXT NOT NULL,
      verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, actor_id TEXT, target_id TEXT, action TEXT NOT NULL,
      created_at TEXT NOT NULL, details TEXT NOT NULL
    );`);
  return db;
}
function audit(db, actor, target, action, details = {}) {
  db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?)').run(randomUUID(), actor, target, action, new Date().toISOString(), JSON.stringify(details));
}
function applyGoogleApproval(db, user) {
  if (!user.google_sub || user.status !== 'pending') return user;
  const approval = db.prepare('SELECT * FROM email_approvals WHERE email=?').get(user.email);
  if (!approval) return user;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET role=?,status=? WHERE id=?').run(approval.role,'active',user.id);
    db.prepare('DELETE FROM email_approvals WHERE email=?').run(user.email);
    audit(db,approval.approved_by,user.id,'access.email.claimed',{role:approval.role});
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
  return db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
}
function rateLimit(db, key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(now);
  const row = db.prepare('SELECT * FROM rate_limits WHERE key=?').get(key);
  if (row && row.count >= limit) bad('Demasiados intentos. Intenta de nuevo más tarde.', 429);
  db.prepare(`INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1`).run(key, now + windowMs);
}
function createSession(db, userId) {
  const token = secret();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), userId, Date.now() + 8 * 60 * 60 * 1000);
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(new Date().toISOString(), userId);
  return token;
}
function sessionUser(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.status!='disabled'`).get(digest(token), Date.now());
}
module.exports = { applyGoogleApproval, ROLES, STATUSES, digest, secret, emailOf, bad, validateEmail, validateName, hashPassword,
  verifyPassword, publicUser, openDatabase, audit, rateLimit, createSession, sessionUser };

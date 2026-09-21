const { openDatabase } = require('./database.cjs');
const { randomBytes, randomUUID, createHash, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
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
async function audit(db, actor, target, action, details = {}) {
  await db.saveAudit({ id: randomUUID(), actor_id: actor, target_id: target, action,
    created_at: new Date().toISOString(), details });
}
async function applyGoogleApproval(db, user) {
  return db.transaction(async () => {
    user = await db.getUser(user.id);
    if (!user.google_sub || user.status !== 'pending') return user;
    const approval = await db.getApproval(user.email);
    if (!approval) return user;
    await db.updateUser(user.id, { role: approval.role, status: 'active' });
    await db.deleteApproval(user.email);
    await audit(db,approval.approved_by,user.id,'access.email.claimed',{role:approval.role});
    return db.getUser(user.id);
  });
}
async function rateLimit(db, key, limit = 10, windowMs = 15 * 60 * 1000) {
  if (!await db.incrementRate(key, limit, Date.now(), windowMs)) bad('Demasiados intentos. Intenta de nuevo más tarde.', 429);
}
async function createSession(db, userId) {
  const token = secret();
  await db.transaction(async () => {
    const user = await db.getUser(userId);
    if (!user || user.status === 'disabled') bad('Cuenta no disponible.',401);
    await db.saveSession({ token_hash: digest(token), user_id: userId,
      session_version: user.session_version || 0, expires_at: Date.now() + 8 * 60 * 60 * 1000 });
    await db.updateUser(userId, { last_login: new Date().toISOString() });
  });
  return token;
}
async function sessionUser(db, token) {
  if (!token) return null;
  const session = await db.getSession(digest(token));
  if (!session || session.expires_at <= Date.now()) return null;
  const user = await db.getUser(session.user_id);
  if (!user || user.status === 'disabled' || (user.session_version || 0) !== session.session_version) return null;
  return user;
}
module.exports = { applyGoogleApproval, ROLES, STATUSES, digest, secret, emailOf, bad, validateEmail, validateName, hashPassword,
  verifyPassword, publicUser, openDatabase, audit, rateLimit, createSession, sessionUser };

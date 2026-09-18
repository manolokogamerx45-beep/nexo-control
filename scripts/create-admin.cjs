const { randomUUID } = require('node:crypto');
const { openDatabase, validateEmail, validateName, hashPassword, audit } = require('../lib/auth.cjs');
(async () => {
  const email = validateEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  const name = validateName(process.env.BOOTSTRAP_ADMIN_NAME);
  const password = await hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD);
  const db = openDatabase(process.env.DATABASE_PATH || './data/nexo.sqlite');
  try {
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('Ese correo ya existe. No se modificó la cuenta.');
    const id = randomUUID();
    db.prepare(`INSERT INTO users(id,email,name,password_hash,role,status,created_at) VALUES (?,?,?,?,'administrador','active',?)`)
      .run(id, email, name, password, new Date().toISOString());
    audit(db, id, id, 'admin.bootstrap');
    console.log('Administrador creado. Retira BOOTSTRAP_ADMIN_PASSWORD de .env.');
  } finally { db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

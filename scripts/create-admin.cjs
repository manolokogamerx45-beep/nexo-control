const { randomUUID } = require('node:crypto');
const { openDatabase, validateEmail, validateName, hashPassword, audit } = require('../lib/auth.cjs');
(async () => {
  const email = validateEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  const name = validateName(process.env.BOOTSTRAP_ADMIN_NAME);
  const password = await hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD);
  const db = openDatabase();
  try {
    await db.ready;
    await db.transaction(async () => {
      if (await db.findUser('email',email)) throw new Error('Ese correo ya existe. No se modificó la cuenta.');
      const id = randomUUID();
      await db.createUser({id:id,email:email,name:name,password_hash:password,role:'administrador',status:'active',created_at:new Date().toISOString()});
      await audit(db, id, id, 'admin.bootstrap');
    });
    console.log('Administrador creado. Retira BOOTSTRAP_ADMIN_PASSWORD de .env.');
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

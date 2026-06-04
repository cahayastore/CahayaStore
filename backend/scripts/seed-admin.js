#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../src/db');

async function run() {
  const email = (process.env.ADMIN_EMAIL || 'owner@cahayastore.me').toLowerCase();
  const name = process.env.ADMIN_NAME || 'Cahaya Store Owner';
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(12).toString('base64url'); generated = true; }
  const hash = await bcrypt.hash(password, 12);
  const r = await pool.query(
    `INSERT INTO users (role, name, email, password_hash, is_active)
     VALUES ('owner', $1, $2, $3, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = 'owner',
           is_active = TRUE,
           updated_at = now()
     RETURNING id, email, role`,
    [name, email, hash]
  );
  console.log('Seeded:', r.rows[0]);
  if (generated) {
    console.log('Generated password (save now):', password);
  } else {
    console.log('Used ADMIN_PASSWORD from env.');
  }
  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
'use strict';
/**
 * Simple forward-only migration runner.
 * Reads backend/migrations/*.sql in sorted order, executes those not yet recorded in schema_migrations.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function run() {
  await ensureTable();
  const dir = path.resolve(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const r = await pool.query("SELECT filename FROM schema_migrations");
  const done = new Set(r.rows.map(x => x.filename));
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    process.stdout.write(`-> ${f} ... `);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
      await client.query('COMMIT');
      applied++;
      console.log('ok');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAIL');
      console.error(e.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  console.log(`Applied ${applied} migration(s).`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });

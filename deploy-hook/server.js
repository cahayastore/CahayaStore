'use strict';
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 9000);
const SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const REPO_PATH = process.env.REPO_PATH || '/root/cahayastore';
const BRANCH = process.env.BRANCH || 'main';
const LOG_FILE = process.env.LOG_FILE || '/var/log/cahayastore-deploy.log';

if (!SECRET) {
  console.error('GITHUB_WEBHOOK_SECRET is required');
  process.exit(1);
}

function log(line) {
  const stamp = `[${new Date().toISOString()}] `;
  fs.appendFile(LOG_FILE, stamp + line + '\n', () => {});
  process.stdout.write(stamp + line + '\n');
}

function safeEqual(a, b) {
  try {
    const ab = Buffer.from(a, 'utf8'); const bb = Buffer.from(b, 'utf8');
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  } catch { return false; }
}

let deploying = false;
function runDeploy() {
  if (deploying) { log('skip: already deploying'); return; }
  deploying = true;
  const script = `cd ${REPO_PATH} && git fetch --all && git reset --hard origin/${BRANCH} && bash deploy.sh`;
  log('exec: ' + script);
  exec(script, { timeout: 5 * 60 * 1000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
    deploying = false;
    if (err) log('FAIL: ' + err.message);
    if (stdout) log('stdout: ' + stdout.trim());
    if (stderr) log('stderr: ' + stderr.trim());
    log('done');
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/status')) {
    res.setHeader('Content-Type', 'text/plain');
    fs.readFile(LOG_FILE, 'utf8', (e, t) => {
      if (e) return res.end('no log yet');
      res.end(t.split('\n').slice(-50).join('\n'));
    });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.statusCode = 404; return res.end('not found');
  }
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const sig = req.headers['x-hub-signature-256'] || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
    if (!safeEqual(sig, expected)) {
      log('rejected: bad signature');
      res.statusCode = 401; return res.end('bad signature');
    }
    let payload;
    try {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(raw.toString('utf8'));
        payload = JSON.parse(params.get('payload') || '{}');
      } else {
        payload = JSON.parse(raw.toString('utf8'));
      }
    } catch (e) {
      log('rejected: bad json ' + e.message);
      res.statusCode = 400; return res.end('bad json');
    }
    const ref = payload.ref || '';
    const event = req.headers['x-github-event'] || '';
    log(`event=${event} ref=${ref}`);
    if (event === 'ping') return res.end('pong');
    if (event !== 'push') return res.end('ignored');
    if (ref !== `refs/heads/${BRANCH}`) return res.end('ignored branch');
    runDeploy();
    res.end('queued');
  });
});

server.listen(PORT, '127.0.0.1', () => log('listening on 127.0.0.1:' + PORT));

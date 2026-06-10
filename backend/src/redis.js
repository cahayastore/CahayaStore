'use strict';
/* Optional Redis client. Returns a shared ioredis instance when REDIS_URL is
   set, otherwise null so callers can fall back to in-memory behaviour. */
let client = null;
let attempted = false;

function getRedis() {
  if (attempted) return client;
  attempted = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const Redis = require('ioredis');
    client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on('error', (e) => console.warn('[redis]', e.message));
    return client;
  } catch (e) {
    console.warn('[redis] unavailable:', e.message);
    client = null;
    return null;
  }
}

module.exports = { getRedis };

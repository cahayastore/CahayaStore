/* API client + session for Cahaya Store admin panel */
export const API_BASE = 'https://api.cahayastore.me';

const TOKEN_KEY = 'cs_admin_token';
const USER_KEY = 'cs_admin_user';

export const session = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },
  set: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user || {}));
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
};

export async function api(path, opts = {}) {
  // For FormData (file uploads) we must NOT set Content-Type — the browser sets
  // 'multipart/form-data; boundary=...' itself. Forcing application/json makes
  // the server try to JSON-parse the binary body (entity.parse.failed → 500).
  const isForm = (typeof FormData !== 'undefined') && (opts.body instanceof FormData);
  const headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) };
  const tok = session.getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { /* non-json response */ }
  if (res.status === 401) {
    session.clear();
    location.hash = '#/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    throw new Error((body && body.message) || `HTTP ${res.status}`);
  }
  return body;
}

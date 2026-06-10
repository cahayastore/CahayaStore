'use strict';
/* ════════════════════════════════════════════════════════════════════
   Customer auth helpers — passwordless guest accounts.
   Two JWTs signed with the same JWT_SECRET:
     - gateway access token (full login, 7d) + refresh (30d)
     - web-session token (read order history/credentials, 90d, scope:web-session)
   Roles are read from DB at verify time, never trusted from the JWT claim.
   ════════════════════════════════════════════════════════════════════ */
const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET;

function issueGatewaySession(user) {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, type: 'access' },
    SECRET(),
    { expiresIn: '7d' }
  );
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    SECRET(),
    { expiresIn: '30d' }
  );
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || (user.email ? user.email.split('@')[0] : null),
      role: user.role || 'buyer',
    },
  };
}

function issueWebSession(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, scope: 'web-session' },
    SECRET(),
    { expiresIn: '90d' }
  );
}

function verifyAny(token) {
  try { return jwt.verify(token, SECRET()); } catch { return null; }
}

/* Resolve the customer id from a request: Bearer access token OR
   webSessionToken (query/body). Returns { userId, via } or null. */
function resolveCustomer(req) {
  const h = String(req.headers.authorization || '');
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (bearer) {
    const p = verifyAny(bearer);
    if (p && p.sub && (p.type === 'access' || p.role || p.scope === undefined)) {
      return { userId: p.sub, via: 'bearer' };
    }
  }
  const ws = req.query.webSessionToken || req.query.ws || (req.body && req.body.webSessionToken);
  if (ws) {
    const p = verifyAny(String(ws));
    if (p && p.sub && p.scope === 'web-session') {
      return { userId: p.sub, via: 'web-session' };
    }
  }
  return null;
}

/* Express middleware: require a customer (Bearer access or web-session). */
function requireCustomerAuth(req, res, next) {
  const c = resolveCustomer(req);
  if (!c) return res.status(401).json({ success: false, message: 'Perlu login.' });
  req.customerId = c.userId;
  req.customerVia = c.via;
  next();
}

module.exports = { issueGatewaySession, issueWebSession, verifyAny, resolveCustomer, requireCustomerAuth };
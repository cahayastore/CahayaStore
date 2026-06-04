'use strict';
const jwt = require('jsonwebtoken');

function requireAuth(roles = null) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Missing token' });
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      if (roles && !roles.includes(payload.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      next();
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
}

function signToken(user, ttlSec = 60 * 60 * 12) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: ttlSec }
  );
}

module.exports = { requireAuth, signToken };

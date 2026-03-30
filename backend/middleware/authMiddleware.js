/* ============================================================
   T-ASISTO · middleware/authMiddleware.js
   ============================================================ */
const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const token = auth.slice(7);
  try {
    req.admin = jwt.verify(
      token,
      process.env.JWT_SECRET || 'tasisto_jwt_secret_2026'
    );
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

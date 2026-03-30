/* ============================================================
   T-ASISTO · routes/admin.js — Panel de administración
   ============================================================ */
const router      = require('express').Router();
const bcrypt      = require('bcrypt');
const { pool }    = require('../db');
const requireAuth = require('../middleware/authMiddleware');

// ── GET /api/admin/stats ─────────────────────────────────────
router.get('/stats', requireAuth, async (_req, res) => {
  try {
    const [total, today, pending] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM sessions'),
      pool.query("SELECT COUNT(*) FROM sessions WHERE created_at >= CURRENT_DATE"),
      pool.query("SELECT COUNT(*) FROM sessions WHERE status = 'pending'"),
    ]);
    res.json({
      total:   parseInt(total.rows[0].count),
      today:   parseInt(today.rows[0].count),
      pending: parseInt(pending.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/conversations ─────────────────────────────
router.get('/conversations', requireAuth, async (req, res) => {
  const q      = req.query.q || '';
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const { rows } = await pool.query(`
      SELECT
        s.*,
        (SELECT COUNT(*)  FROM messages m WHERE m.session_id = s.id)                    AS message_count,
        (SELECT content   FROM messages m WHERE m.session_id = s.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages m WHERE m.session_id = s.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
      FROM sessions s
      WHERE ($1 = '' OR s.nombre ILIKE $2 OR s.email ILIKE $2 OR s.telefono ILIKE $2)
      ORDER BY s.created_at DESC
      LIMIT $3 OFFSET $4
    `, [q, `%${q}%`, limit, offset]);

    const countRes = await pool.query(`
      SELECT COUNT(*) FROM sessions
      WHERE ($1 = '' OR nombre ILIKE $2 OR email ILIKE $2 OR telefono ILIKE $2)
    `, [q, `%${q}%`]);

    res.json({ rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/conversations/:id ────────────────────────
router.get('/conversations/:id', requireAuth, async (req, res) => {
  try {
    const session = await pool.query(
      'SELECT * FROM sessions WHERE id = $1', [req.params.id]
    );
    if (!session.rows.length) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const messages = await pool.query(
      'SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    res.json({ session: session.rows[0], messages: messages.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/conversations/:id ─────────────────────
router.delete('/conversations/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/conversations/bulk ───────────────────
router.delete('/conversations/bulk', requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'Lista de ids requerida' });
  }
  try {
    await pool.query('DELETE FROM sessions WHERE id = ANY($1::int[])', [ids]);
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/settings ──────────────────────────────────
router.get('/settings', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings');
    const out = {};
    rows.forEach(r => (out[r.key] = r.value));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/admin/settings ──────────────────────────────────
router.put('/settings', requireAuth, async (req, res) => {
  const { n8n_webhook } = req.body;
  if (typeof n8n_webhook === 'undefined') {
    return res.status(400).json({ error: 'Campo n8n_webhook requerido' });
  }
  try {
    await pool.query(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('n8n_webhook', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [n8n_webhook.trim()]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/admin/password ──────────────────────────────────
router.put('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Contraseñas requeridas' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Mínimo 6 caracteres' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM admins WHERE id = $1', [req.admin.id]
    );
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE admins SET password_hash = $1 WHERE id = $2',
      [hash, req.admin.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

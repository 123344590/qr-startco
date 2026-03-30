/* ============================================================
   T-ASISTO · routes/messages.js — Polling del frontend
   ============================================================ */
const router   = require('express').Router();
const { pool } = require('../db');

// GET /api/messages/:sessionId?after=<lastId>
// Devuelve mensajes nuevos con id > after (default 0)
router.get('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const after = parseInt(req.query.after) || 0;

  try {
    const { rows } = await pool.query(`
      SELECT id, content, sender_type, sender_name, created_at
      FROM   messages
      WHERE  session_id = $1 AND id > $2
      ORDER  BY created_at ASC
    `, [sessionId, after]);

    res.json({ messages: rows });
  } catch (err) {
    console.error('[messages] Error:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;

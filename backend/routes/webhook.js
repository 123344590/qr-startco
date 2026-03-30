/* ============================================================
   T-ASISTO · routes/webhook.js
   Endpoints que reciben datos del formulario y de n8n/Chatwoot
   ============================================================ */
const router      = require('express').Router();
const rateLimit   = require('express-rate-limit');
const { pool }    = require('../db');

// Rate-limit para el endpoint público de envío (10 req / 5 min / IP)
const submitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' },
});

// ────────────────────────────────────────────────────────────
// POST /api/webhook/submit
// Recibe el formulario del frontend, guarda la sesión y
// reenvía a n8n (URL configurada en settings).
// ────────────────────────────────────────────────────────────
router.post('/submit', submitLimiter, async (req, res) => {
  const { sessionId, nombre, email, telefono, notas } = req.body;

  if (!sessionId || !nombre) {
    return res.status(400).json({ error: 'sessionId y nombre son requeridos' });
  }

  // Guardar sesión inmediatamente
  try {
    await pool.query(`
      INSERT INTO sessions (id, nombre, email, telefono, notas, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      ON CONFLICT (id) DO NOTHING
    `, [sessionId, nombre, email || '', telefono || '', notas || '']);
  } catch (dbErr) {
    console.error('[submit] DB error:', dbErr.message);
    return res.status(500).json({ error: 'Error al guardar sesión' });
  }

  // Obtener URL de n8n desde settings
  const { rows } = await pool.query(
    "SELECT value FROM settings WHERE key = 'n8n_webhook'"
  );
  const n8nUrl = rows[0]?.value?.trim();

  if (!n8nUrl) {
    // Sin webhook configurado → respuesta inmediata de fallback
    return res.json({
      ok:      true,
      mensaje: '¡Gracias! Hemos recibido tu información. En breve te contactamos.',
    });
  }

  // Reenviar a n8n (no-blocking: respondemos al form enseguida)
  res.json({ ok: true });

  // Fire-and-forget hacia n8n
  fetch(n8nUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ sessionId, nombre, email: email || '', telefono: telefono || '', notas: notas || '' }),
    signal:  AbortSignal.timeout(20000),
  }).catch(err => console.warn('[submit] n8n no respondió:', err.message));
});

// ────────────────────────────────────────────────────────────
// POST /api/webhook/response
// n8n llama aquí después de crear la conversación en Chatwoot.
// Guarda el mensaje automático (primer / segundo mensaje).
// Body esperado: { sessionId, mensaje, conversationId?, sourceId? }
// ────────────────────────────────────────────────────────────
router.post('/response', async (req, res) => {
  const { sessionId, mensaje, conversationId, sourceId } = req.body;

  if (!sessionId || !mensaje) {
    return res.status(400).json({ error: 'sessionId y mensaje son requeridos' });
  }

  try {
    // Actualizar datos de Chatwoot si llegaron
    if (conversationId) {
      await pool.query(`
        UPDATE sessions
        SET chatwoot_conversation_id = $1,
            chatwoot_source_id       = $2,
            status                   = 'active',
            updated_at               = NOW()
        WHERE id = $3
      `, [conversationId, sourceId || null, sessionId]);
    }

    // Guardar el mensaje
    await pool.query(`
      INSERT INTO messages (session_id, content, sender_type, sender_name)
      VALUES ($1, $2, 'agent', 'T-ASISTO')
    `, [sessionId, mensaje]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[response] Error:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/webhook/agent-message
// Recibe mensajes de agentes reales desde Chatwoot (vía n8n).
// El segundo workflow de n8n llama aquí cuando un agente
// escribe en Chatwoot.
// Body esperado: { sessionId, mensaje, senderName? }
// ────────────────────────────────────────────────────────────
router.post('/agent-message', async (req, res) => {
  const { sessionId, mensaje, senderName } = req.body;

  if (!sessionId || !mensaje) {
    return res.status(400).json({ error: 'sessionId y mensaje son requeridos' });
  }

  try {
    // Verificar que la sesión existe
    const { rows } = await pool.query(
      'SELECT id FROM sessions WHERE id = $1', [sessionId]
    );
    if (!rows.length) {
      // Sesión desconocida → ignorar silenciosamente
      return res.json({ ok: true, skipped: true });
    }

    await pool.query(`
      INSERT INTO messages (session_id, content, sender_type, sender_name)
      VALUES ($1, $2, 'agent', $3)
    `, [sessionId, mensaje, senderName || 'Asesor']);

    // Marcar sesión como activa si aún era pending
    await pool.query(`
      UPDATE sessions SET status = 'active', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
    `, [sessionId]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[agent-message] Error:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;

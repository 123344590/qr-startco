/* ============================================================
   T-ASISTO · server.js — Punto de entrada del backend
   ============================================================ */
require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const { initDb } = require('./db');

const app = express();

// ── Middlewares ──────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }));
app.use(express.json({ limit: '2mb' }));

// ── Panel admin (archivos estáticos) ────────────────────────
app.use('/admin',      express.static(path.join(__dirname, '../admin')));

// ── Formulario público ────────────────────────────────────────
app.use('/formulario', express.static(path.join(__dirname, '../formulario')));

// ── Rutas API ────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/admin',    require('./routes/admin'));
app.use('/api/webhook',  require('./routes/webhook'));
app.use('/api/messages', require('./routes/messages'));

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

// ── 404 ──────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ── Error global ─────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[T-ASISTO] Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Arranque ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 T-ASISTO Backend  →  http://localhost:${PORT}`);
      console.log(`📋 Panel admin       →  http://localhost:${PORT}/admin\n`);
    });
  })
  .catch(err => {
    console.error('❌ No se pudo inicializar la base de datos:', err.message);
    process.exit(1);
  });

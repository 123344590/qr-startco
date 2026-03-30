/* ============================================================
   T-ASISTO · db.js — Pool de PostgreSQL + inicialización
   ============================================================ */
require('dotenv').config();
const { Pool }  = require('pg');
const bcrypt    = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://tasisto_user:TasiSto2026!@localhost:5433/tasisto',
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  const client = await pool.connect();
  try {
    // ── Tablas ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(50)  UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at    TIMESTAMPTZ  DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id                        VARCHAR(100) PRIMARY KEY,
        nombre                    VARCHAR(200) NOT NULL,
        email                     VARCHAR(200),
        telefono                  VARCHAR(50),
        notas                     TEXT,
        chatwoot_conversation_id  INT,
        chatwoot_source_id        VARCHAR(200),
        status                    VARCHAR(20)  DEFAULT 'pending',
        created_at                TIMESTAMPTZ  DEFAULT NOW(),
        updated_at                TIMESTAMPTZ  DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id           SERIAL       PRIMARY KEY,
        session_id   VARCHAR(100) REFERENCES sessions(id) ON DELETE CASCADE,
        content      TEXT         NOT NULL,
        sender_type  VARCHAR(20)  NOT NULL,
        sender_name  VARCHAR(200),
        created_at   TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    // ── Configuraciones por defecto ──────────────────────────
    await client.query(`
      INSERT INTO settings (key, value)
      VALUES ('n8n_webhook', ''), ('agent_webhook_secret', '')
      ON CONFLICT (key) DO NOTHING;
    `);

    // ── Admin inicial (solo si no existe ninguno) ────────────
    const { rows } = await client.query('SELECT COUNT(*) FROM admins');
    if (parseInt(rows[0].count) === 0) {
      const hash = await bcrypt.hash(
        process.env.ADMIN_PASS || 'Admin2026!', 10
      );
      await client.query(
        'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
        [process.env.ADMIN_USER || 'admin', hash]
      );
      console.log(
        `✅ Admin creado → usuario: "${process.env.ADMIN_USER || 'admin'}"  contraseña: "${process.env.ADMIN_PASS || 'Admin2026!'}"`
      );
    }

    console.log('✅ Base de datos lista');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };

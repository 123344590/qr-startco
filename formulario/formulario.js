/* ============================================================
   T-ASISTO · Diagnóstico de Leads → n8n → Chatwoot
   ============================================================ */

// ── URL del backend — usa ruta relativa en producción ────────
const BACKEND_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001/api'
  : `${window.location.origin}/api`;

// ── Referencias DOM ─────────────────────────────────────────
const form         = document.getElementById('contactForm');
const btnSubmit    = document.getElementById('btnSubmit');
const successPanel = document.getElementById('successPanel');
const errorPanel   = document.getElementById('errorPanel');
const ticketInfo   = document.getElementById('ticketInfo');
const errorMsg     = document.getElementById('errorMsg');
const btnRetry     = document.getElementById('btnRetry');
const chatMessages = document.getElementById('chatMessages');

// ── Estado de sesión y polling ─────────────────────────────────
let currentSessionId = null;
let pollingTimer     = null;
let pollingCount     = 0;
let lastMessageId    = 0;     // último id recibido (evita duplicados)
const POLL_INTERVAL  = 3000; // 3 segundos entre consultas
const POLL_MAX       = 60;   // máx ~3 minutos sin respuesta

function generateSessionId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 8);
}

// ── Chip "Otro" en Q1: mostrar input al seleccionar ─────────
const otroChk = document.getElementById('q1_otro_chk');
const otroTxt = document.getElementById('q1_otro_txt');
if (otroChk && otroTxt) {
  otroChk.addEventListener('change', () => {
    otroTxt.style.display = otroChk.checked ? 'block' : 'none';
    if (otroChk.checked) otroTxt.focus();
  });
}

// ── Limpiar errores al interactuar ──────────────────────────
document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('input',  () => clearError(el));
  el.addEventListener('change', () => clearError(el));
});

// ── Validación ──────────────────────────────────────────────
function validateForm() {
  let valid = true;

  const nombre = document.getElementById('f_nombre');
  const email  = document.getElementById('f_email');

  if (!nombre.value.trim()) {
    showError(nombre, 'err_nombre');
    valid = false;
  }

  if (email.value.trim()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      showError(email, 'err_email');
      valid = false;
    }
  }

  return valid;
}

// ── Helpers de validación ───────────────────────────────────
function showError(input, errId) {
  input.classList.add('invalid');
  const el = document.getElementById(errId);
  if (el) el.classList.add('visible');
}

function clearError(input) {
  input.classList.remove('invalid');
  const errId = 'err_' + input.id.replace('f_', '');
  const el = document.getElementById(errId);
  if (el) el.classList.remove('visible');
}

function showCheckboxError(errId, labelId) {
  const el = document.getElementById(errId);
  if (el) el.classList.add('visible');
  const lbl = document.getElementById(labelId);
  if (lbl) {
    const chk = lbl.querySelector('.custom-check');
    if (chk) {
      chk.style.borderColor = 'var(--red)';
      chk.style.boxShadow   = '0 0 0 3px rgba(239,68,68,0.12)';
    }
  }
}

// ── Convertir teléfono a E.164 ─────────────────────────────
function toE164(raw, defaultCountry = '52') {
  if (!raw) return '';
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.length >= 8 ? digits : '';
  digits = digits.replace(/^0+/, '');
  if (!digits) return '';
  if (digits.length > 10) return `+${digits}`;
  return `+${defaultCountry}${digits}`;
}

// ── Recoger respuestas del formulario ───────────────────────
function recogerRespuestas() {
  // Q1: checkboxes
  const q1checks = [...document.querySelectorAll('input[name="q1"]:checked')]
    .map(cb => {
      if (cb.value === '__otro__') {
        const txt = document.getElementById('q1_otro_txt')?.value.trim();
        return txt ? `Otro: ${txt}` : 'Otro';
      }
      return cb.value;
    });

  const getRadio = name => {
    const sel = document.querySelector(`input[name="${name}"]:checked`);
    return sel ? sel.value : '';
  };

  return {
    nombre:   document.getElementById('f_nombre').value.trim(),
    telefono: document.getElementById('f_telefono').value.trim(),
    email:    document.getElementById('f_email').value.trim(),
    q1: q1checks.join(', '),
    q2: getRadio('q2'),
    q3: getRadio('q3'),
    q4: getRadio('q4'),
    q5: getRadio('q5'),
    q6: getRadio('q6'),
  };
}

// ── Construir el campo "notas" ──────────────────────────────
function buildNotas(d) {
  const lineas = [`Nombre: ${d.nombre}`];
  if (d.telefono) lineas.push(`Teléfono: ${d.telefono}`);
  if (d.email)    lineas.push(`Email: ${d.email}`);
  lineas.push('');
  const qs = [
    ['¿Por cuáles canales reciben consultas?', d.q1],
    ['¿Centralizan mensajes o cada asesor?',   d.q2],
    ['¿Cómo hacen seguimiento a prospectos?',  d.q3],
    ['¿Visibilidad del pipeline?',             d.q4],
    ['¿Han usado CRM antes?',                  d.q5],
    ['¿Apertura a herramientas digitales?',    d.q6],
  ];
  qs.forEach(([p, r]) => {
    if (r) lineas.push(`${p}\n→ ${r}`);
  });
  return lineas.join('\n');
}

// ── Construir resumen visible en el chat (solo datos básicos) ───
function buildResumenChat(d) {
  const filas = [{ icon: '👤', text: d.nombre }];
  if (d.telefono) filas.push({ icon: '📞', text: d.telefono });
  if (d.email)    filas.push({ icon: '✉️', text: d.email });
  return filas;
}

// ── Chat: añadir burbuja ─────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function addChatBubble(text, type) {
  const wrap = document.createElement('div');
  wrap.classList.add('chat-bubble-wrap', `wrap-${type}`);

  if (type === 'typing') {
    wrap.dataset.typing = 'true';
    wrap.innerHTML = `
      <div class="chat-bubble bubble-agent typing-bubble">
        <span class="typing-dots"><span></span><span></span><span></span></span>
      </div>`;
  } else {
    const bbl = document.createElement('div');
    bbl.classList.add('chat-bubble', `bubble-${type}`);

    if (Array.isArray(text)) {
      bbl.innerHTML = text
        .map(r => `<span class="bubble-row"><span class="bubble-icon">${r.icon}</span><span class="bubble-txt">${escapeHtml(r.text)}</span></span>`)
        .join('');
    } else {
      bbl.textContent = text;
    }
    wrap.appendChild(bbl);
  }

  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return wrap;
}

function removeTyping() {
  chatMessages.querySelector('[data-typing="true"]')?.remove();
}

// ── Polling: esperar respuesta del agente en Chatwoot ────────
function stopPolling() {
  if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
  pollingCount = 0;
}

// ── Polling: consulta el backend cada POLL_INTERVAL ms ────────────
async function pollMessages(sessionId) {
  if (pollingCount >= POLL_MAX) {
    removeTyping();
    addChatBubble('Un asesor te contactará pronto por los datos que dejaste. 👋', 'agent');
    stopPolling();
    return;
  }
  pollingCount++;

  try {
    const res = await fetch(
      `${BACKEND_URL}/messages/${sessionId}?after=${lastMessageId}`
    );
    if (res.ok) {
      const { messages } = await res.json();
      if (messages && messages.length > 0) {
        removeTyping();
        for (const msg of messages) {
          addChatBubble(msg.content, 'agent');
          lastMessageId = msg.id;
        }
        // Seguir esperando mensajes de agentes reales
        addChatBubble('', 'typing');
        pollingCount = 0; // reset: puede llegar más mensajes
      }
    }
  } catch (_) { /* red ocupada, reintentar */ }

  pollingTimer = setTimeout(() => pollMessages(sessionId), POLL_INTERVAL);
}

// ── Envío al backend propio ─────────────────────────────────
async function enviarBackend(datos, sessionId) {
  const telefonoE164 = toE164(datos.telefono);

  const payload = {
    sessionId,
    nombre:   datos.nombre,
    email:    datos.email    || '',
    telefono: (telefonoE164 && /^\+\d{7,15}$/.test(telefonoE164))
              ? telefonoE164 : (datos.telefono || ''),
    notas:    buildNotas(datos),
  };

  const res = await fetch(`${BACKEND_URL}/webhook/submit`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Error ${res.status}: ${txt || 'sin detalle'}`);
  }

  return await res.json().catch(() => ({}));
}

// ── Manejo del envío ─────────────────────────────────────────
form.addEventListener('submit', async e => {
  e.preventDefault();

  if (!validateForm()) {
    form.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const datos     = recogerRespuestas();
  const sessionId = generateSessionId();
  currentSessionId = sessionId;
  lastMessageId    = 0;

  btnSubmit.disabled = true;
  btnSubmit.classList.add('loading');
  stopPolling();

  // Mostrar panel de chat con burbuja del usuario (solo nombre/tel/email)
  chatMessages.innerHTML = '';
  showPanel(successPanel);
  addChatBubble(buildResumenChat(datos), 'user');
  addChatBubble('', 'typing');

  try {
    // Enviar al backend (responde inmediatamente, n8n trabaja en segundo plano)
    const respuesta = await enviarBackend(datos, sessionId);

    // Badge del ticket (si el backend lo devuelve)
    if (respuesta.ticketId) ticketInfo.textContent = `Ticket ${respuesta.ticketId}`;

    removeTyping();
    addChatBubble('', 'typing'); // typing mientras llegan los mensajes del backend

    // Iniciar polling para recibir los mensajes de n8n/Chatwoot
    pollingCount = 0;
    pollingTimer = setTimeout(() => pollMessages(sessionId), POLL_INTERVAL);

  } catch (err) {
    console.error('[T-ASISTO]', err);
    removeTyping();
    stopPolling();
    // Mostrar el error real de n8n para poder diagnosticar
    let msg = err.message || 'Error desconocido';
    if (/fetch|network|CORS/i.test(err.message)) {
      msg = 'Error de conexión. Verifica tu red e intenta de nuevo.';
    }
    hidePanel(successPanel);
    errorMsg.textContent = msg;
    showPanel(errorPanel);

  } finally {
    btnSubmit.disabled = false;
    btnSubmit.classList.remove('loading');
  }
});

// ── Helpers de paneles ──────────────────────────────────────
function showPanel(panel) {
  panel.classList.add('visible');
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hidePanel(panel) {
  panel.classList.remove('visible');
}

// ── Botón: Intentar de nuevo ─────────────────────────────────
btnRetry.addEventListener('click', () => hidePanel(errorPanel));

// ── Micro-interacciones en inputs ────────────────────────────
document.querySelectorAll('.input-wrap').forEach(wrap => {
  const input = wrap.querySelector('input[type="text"], input[type="email"], input[type="tel"]');
  const icon  = wrap.querySelector('.input-icon');
  if (!input || !icon) return;
  input.addEventListener('focus', () => { icon.style.color = 'var(--blue)'; });
  input.addEventListener('blur',  () => { if (!input.value) icon.style.color = ''; });
});
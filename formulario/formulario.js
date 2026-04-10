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
const formCard     = document.querySelector('.form-card');
const formAlert    = document.getElementById('formAlert');
const dataModal    = document.getElementById('dataModal');
const openDataBtn  = document.getElementById('openDataModal');
const closeDataBtn = document.getElementById('closeDataModal');
const acceptDataBtn = document.getElementById('acceptDataModal');
const consentDataChk = document.getElementById('consent_data');
let allowDataConsentProgrammaticCheck = false;

// ── Estado de sesión y polling ─────────────────────────────────
let currentSessionId    = null;
let pollingTimer        = null;
let pollingCount        = 0;
let lastMessageId       = 0;    // último id recibido (evita duplicados)
let hasReceivedMessage  = false; // si ya llegó al menos un mensaje del agente
const POLL_INTERVAL     = 3000; // 3 segundos entre consultas
const POLL_MAX          = 60;   // ~3 min de espera inicial (sin ningún mensaje)
const POLL_MAX_AFTER    = 400;  // ~20 min después del primer mensaje

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
  otroTxt.addEventListener('input', () => clearQuestionError('q1', 'dq1'));
}

// ── Limpiar errores al interactuar ──────────────────────────
document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('input',  () => clearError(el));
  el.addEventListener('change', () => clearError(el));
});

document.querySelectorAll('input[name="q1"]').forEach(el => {
  el.addEventListener('change', () => clearQuestionError('q1', 'dq1'));
});

['q2','q3','q4','q5','q6'].forEach(q => {
  document.querySelectorAll(`input[name="${q}"]`).forEach(el => {
    const qNumber = q.replace('q', '');
    el.addEventListener('change', () => clearQuestionError(q, `dq${qNumber}`));
  });
});

document.getElementById('consent_data')?.addEventListener('change', () => clearConsentError('err_data', 'lbl_data'));

// ── Validación ──────────────────────────────────────────────
function validateForm() {
  let valid = true;

  const nombre = document.getElementById('f_nombre');
  const telefono = document.getElementById('f_telefono');
  const email  = document.getElementById('f_email');
  const q1Sel = [...document.querySelectorAll('input[name="q1"]:checked')];
  const data  = document.getElementById('consent_data');
  const faltantes = [];
  let firstInvalid = null;

  const setFirst = el => {
    if (!firstInvalid) firstInvalid = el;
  };

  if (!nombre.value.trim()) {
    showError(nombre, 'err_nombre');
    valid = false;
    setFirst(nombre);
    faltantes.push('Nombre');
  }

  if (!telefono.value.trim()) {
    showError(telefono, 'err_telefono');
    valid = false;
    setFirst(telefono);
    faltantes.push('Teléfono');
  } else {
    const phoneDigits = telefono.value.replace(/\D/g, '');
    if (phoneDigits.length < 7) {
      showError(telefono, 'err_telefono');
      valid = false;
      setFirst(telefono);
      faltantes.push('Teléfono válido');
    }
  }

  if (!email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    showError(email, 'err_email');
    valid = false;
    setFirst(email);
    faltantes.push('Correo electrónico válido');
  }

  if (!q1Sel.length) {
    showQuestionError('q1', 'dq1');
    valid = false;
    setFirst(document.getElementById('dq1'));
    faltantes.push('Pregunta 1');
  }

  const otroChecked = document.getElementById('q1_otro_chk')?.checked;
  const otroValue = document.getElementById('q1_otro_txt')?.value.trim();
  if (otroChecked && !otroValue) {
    showQuestionError('q1', 'dq1');
    valid = false;
    setFirst(document.getElementById('q1_otro_txt'));
    faltantes.push('Especificar “Otro” en la pregunta 1');
  }

  ['q2','q3','q4','q5','q6'].forEach((q, idx) => {
    const sel = document.querySelector(`input[name="${q}"]:checked`);
    if (!sel) {
      showQuestionError(q, `dq${idx + 2}`);
      valid = false;
      setFirst(document.getElementById(`dq${idx + 2}`));
      faltantes.push(`Pregunta ${idx + 2}`);
    }
  });

  if (!data?.checked) {
    showConsentError('err_data', 'lbl_data');
    valid = false;
    setFirst(document.getElementById('consentWrap'));
    faltantes.push('Aceptar tratamiento de datos');
  }

  if (!valid) {
    if (formAlert) {
      formAlert.innerHTML = `<strong>Te falta completar:</strong><br>${faltantes.map(f => `• ${f}`).join('<br>')}`;
      formAlert.classList.add('visible');
    }
    firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (formAlert) {
    formAlert.classList.remove('visible');
    formAlert.textContent = '';
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
  if (!input?.id) return;
  if (input.id.startsWith('f_')) {
    input.classList.remove('invalid');
    const errId = 'err_' + input.id.replace('f_', '');
    const el = document.getElementById(errId);
    if (el) el.classList.remove('visible');
  }
  if (formAlert) {
    formAlert.classList.remove('visible');
    formAlert.textContent = '';
  }
}

function showConsentError(errId, labelId) {
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

function clearConsentError(errId, labelId) {
  const el = document.getElementById(errId);
  if (el) el.classList.remove('visible');
  const lbl = document.getElementById(labelId);
  const chk = lbl?.querySelector('.custom-check');
  if (chk) {
    chk.style.borderColor = '';
    chk.style.boxShadow = '';
  }
}

function showQuestionError(qName, questionId) {
  document.getElementById(`err_${qName}`)?.classList.add('visible');
  document.getElementById(questionId)?.classList.add('invalid');
}

function clearQuestionError(qName, questionId) {
  document.getElementById(`err_${qName}`)?.classList.remove('visible');
  document.getElementById(questionId)?.classList.remove('invalid');
  if (formAlert) {
    formAlert.classList.remove('visible');
    formAlert.textContent = '';
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

// ── Resumen en el chat: muestra el diagnóstico completo ─────
function buildResumenChat(d) {
  // Reutiliza buildNotas() — mismo texto que llega a n8n/Chatwoot
  return buildNotas(d);
}

// ── Chat: añadir burbuja ─────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Convierte URLs en el texto a <a> clicables (abre en nueva pestaña)
function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  return escapeHtml(text).replace(urlRegex, url => {
    // url ya está escapado por escapeHtml, lo usamos tal cual
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`;
  });
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
    // Siempre texto plano: preserva saltos de línea y convierte URLs en links
    bbl.innerHTML = linkify(String(text ?? '')).replace(/\n/g, '<br>');
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
  const efectivoMax = hasReceivedMessage ? POLL_MAX_AFTER : POLL_MAX;

  if (pollingCount >= efectivoMax) {
    removeTyping();
    // Solo mostrar aviso si NUNCA llegó ningún mensaje del agente
    if (!hasReceivedMessage) {
      addChatBubble('Un asesor te contactará pronto por los datos que dejaste. 👋', 'agent');
    }
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
        hasReceivedMessage = true;
        for (const msg of messages) {
          addChatBubble(msg.content, 'agent');
          lastMessageId = msg.id;
        }
        // Seguir esperando más mensajes del agente
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
    return;
  }

  const datos     = recogerRespuestas();
  const sessionId = generateSessionId();
  currentSessionId    = sessionId;
  lastMessageId       = 0;
  hasReceivedMessage  = false;

  btnSubmit.disabled = true;
  btnSubmit.classList.add('loading');
  stopPolling();

  // Mostrar panel de chat con burbuja del resumen del usuario
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
  if (panel === successPanel) {
    document.body.classList.add('chat-open');
    formCard?.classList.add('chat-mode');
    return;
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hidePanel(panel) {
  panel.classList.remove('visible');
  if (panel === successPanel) {
    document.body.classList.remove('chat-open');
    formCard?.classList.remove('chat-mode');
  }
}

// ── Botón: Intentar de nuevo ─────────────────────────────────
btnRetry.addEventListener('click', () => hidePanel(errorPanel));

// ── Modal tratamiento de datos ───────────────────────────────
function openDataModal() {
  dataModal?.classList.add('active');
  dataModal?.setAttribute('aria-hidden', 'false');
}

function closeDataModal() {
  dataModal?.classList.remove('active');
  dataModal?.setAttribute('aria-hidden', 'true');
}

openDataBtn?.addEventListener('click', e => {
  e.preventDefault();
  openDataModal();
});

// Reglas de la casilla de datos:
// - Si el usuario intenta marcarla manualmente, se revierte y se abre modal.
// - Si el usuario la desmarca manualmente, se permite.
// - Solo se marca al aceptar dentro del modal.
consentDataChk?.addEventListener('change', () => {
  if (consentDataChk.checked && !allowDataConsentProgrammaticCheck) {
    consentDataChk.checked = false;
    openDataModal();
    return;
  }

  if (!consentDataChk.checked) {
    clearConsentError('err_data', 'lbl_data');
  }
});

closeDataBtn?.addEventListener('click', closeDataModal);
acceptDataBtn?.addEventListener('click', () => {
  allowDataConsentProgrammaticCheck = true;
  if (consentDataChk) consentDataChk.checked = true;
  allowDataConsentProgrammaticCheck = false;
  clearConsentError('err_data', 'lbl_data');
  closeDataModal();
});

dataModal?.addEventListener('click', e => {
  if (e.target === dataModal) closeDataModal();
});

// ── Micro-interacciones en inputs ────────────────────────────
document.querySelectorAll('.input-wrap').forEach(wrap => {
  const input = wrap.querySelector('input[type="text"], input[type="email"], input[type="tel"]');
  const icon  = wrap.querySelector('.input-icon');
  if (!input || !icon) return;
  input.addEventListener('focus', () => { icon.style.color = 'var(--blue)'; });
  input.addEventListener('blur',  () => { if (!input.value) icon.style.color = ''; });
});
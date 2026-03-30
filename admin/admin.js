/* ============================================================
   T-ASISTO · admin.js — Lógica del panel de administración
   ============================================================ */

// ── Configuración ────────────────────────────────────────────
const API = window.location.hostname === 'localhost'
  ? 'http://localhost:3001/api'
  : `${window.location.origin}/api`;

// ── Estado ───────────────────────────────────────────────────
let token           = localStorage.getItem('tasisto_token') || '';
let currentConvId   = null;
let searchTimeout   = null;

// ────────────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showDashboard();
  }

  // Login form
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    await doLogin();
  });

  // Search con debounce
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadConversations(e.target.value), 350);
  });
});

// ────────────────────────────────────────────────────────────
// AUTH
// ────────────────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('btnLogin');
  const btnText  = document.getElementById('btnLoginText');

  errEl.classList.remove('visible');
  btn.disabled = true;
  btnText.textContent = 'Iniciando…';

  try {
    const res  = await fetch(`${API}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Credenciales incorrectas');

    token = data.token;
    localStorage.setItem('tasisto_token', token);
    showDashboard(data.username);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Iniciar sesión';
  }
}

function logout() {
  localStorage.removeItem('tasisto_token');
  token = '';
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('dashboardView').classList.remove('active');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
}

// ────────────────────────────────────────────────────────────
// DASHBOARD
// ────────────────────────────────────────────────────────────
async function showDashboard(username) {
  // Decodificar username del token si no se pasa
  if (!username) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      username = payload.username;
    } catch { username = 'admin'; }
  }

  document.getElementById('sidebarUsername').textContent = username;
  document.getElementById('sidebarAvatar').textContent = username[0].toUpperCase();
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('dashboardView').classList.add('active');

  // Cargar datos iniciales
  loadStats();
  loadConversations();
  loadSettings();
}

// ────────────────────────────────────────────────────────────
// NAVEGACIÓN
// ────────────────────────────────────────────────────────────
function showSection(section) {
  // Secciones
  document.getElementById('sectionConversations').style.display =
    section === 'conversations' ? '' : 'none';
  document.getElementById('sectionSettings').style.display =
    section === 'settings' ? '' : 'none';

  // Nav active
  document.getElementById('navConversaciones').classList.toggle('active', section === 'conversations');
  document.getElementById('navConfiguracion').classList.toggle('active', section === 'settings');
}

// ────────────────────────────────────────────────────────────
// STATS
// ────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await apiFetch('/admin/stats');
    const data = await res.json();
    document.getElementById('statTotal').textContent   = data.total   ?? '—';
    document.getElementById('statHoy').textContent     = data.today   ?? '—';
    document.getElementById('statPending').textContent = data.pending ?? '—';
  } catch { /* silencioso */ }
}

// ────────────────────────────────────────────────────────────
// CONVERSACIONES
// ────────────────────────────────────────────────────────────
async function loadConversations(q = '') {
  const tbody = document.getElementById('conversationsTableBody');
  tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">⏳</div><p>Cargando…</p></div></td></tr>`;

  try {
    const res  = await apiFetch(`/admin/conversations?q=${encodeURIComponent(q)}`);
    if (res.status === 401) { logout(); return; }

    const data = await res.json();
    renderTable(data.rows || []);
    loadStats(); // refrescar stats
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">❌</div><p>${err.message}</p></div></td></tr>`;
  }
}

function renderTable(rows) {
  const tbody = document.getElementById('conversationsTableBody');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">📭</div><p>No hay conversaciones aún</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const fecha       = formatDate(row.created_at);
    const badgeClass  = row.status === 'active' ? 'badge-active' : row.status === 'closed' ? 'badge-closed' : 'badge-pending';
    const badgeLabel  = row.status === 'active' ? '● Activo' : row.status === 'closed' ? 'Cerrado' : '⏳ Pendiente';
    const preview     = row.last_message ? truncate(row.last_message, 55) : '—';
    const contacto    = [row.email, row.telefono].filter(Boolean).join(' · ') || '—';

    return `<tr onclick="openConversation('${row.id}')">
      <td class="td-name">${escHtml(row.nombre)}</td>
      <td class="td-muted">${escHtml(contacto)}</td>
      <td class="td-preview">${escHtml(preview)}</td>
      <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
      <td class="td-muted">${fecha}</td>
      <td><span style="color:var(--text-muted);font-size:18px;">›</span></td>
    </tr>`;
  }).join('');
}

// ────────────────────────────────────────────────────────────
// MODAL CONVERSACIÓN
// ────────────────────────────────────────────────────────────
async function openConversation(id) {
  currentConvId = id;

  // Abrir modal vacío mientras carga
  document.getElementById('modalName').textContent    = 'Cargando…';
  document.getElementById('modalContact').textContent = '';
  document.getElementById('modalBody').innerHTML      = '<div style="padding:20px;color:var(--text-muted);text-align:center;">⏳ Cargando conversación…</div>';
  document.getElementById('modalOverlay').classList.add('active');

  try {
    const res  = await apiFetch(`/admin/conversations/${id}`);
    const data = await res.json();
    renderModal(data.session, data.messages);
  } catch (err) {
    document.getElementById('modalBody').innerHTML =
      `<div style="padding:20px;color:#f87171;">Error: ${escHtml(err.message)}</div>`;
  }
}

function renderModal(session, messages) {
  // Header
  document.getElementById('modalAvatar').textContent  = session.nombre[0].toUpperCase();
  document.getElementById('modalName').textContent    = session.nombre;
  const contacto = [session.email, session.telefono].filter(Boolean).join(' · ');
  document.getElementById('modalContact').textContent = contacto || 'Sin contacto registrado';

  // Badge estado
  const st = document.getElementById('modalStatus');
  const badgeClass = session.status === 'active' ? 'badge-active' : session.status === 'closed' ? 'badge-closed' : 'badge-pending';
  const badgeLabel = session.status === 'active' ? '● Activo' : session.status === 'closed' ? 'Cerrado' : '⏳ Pendiente';
  st.className = `badge ${badgeClass}`;
  st.textContent = badgeLabel;

  // Body
  const body = document.getElementById('modalBody');
  let html = '';

  // Notas (resumen del diagnóstico)
  if (session.notas) {
    html += `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:6px;">📋 Diagnóstico enviado</div>`;
    html += `<div class="modal-notas">${escHtml(session.notas)}</div>`;
    html += `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin:12px 0 8px;">💬 Mensajes</div>`;
  }

  if (!messages.length) {
    html += `<div style="color:var(--text-muted);font-size:14px;text-align:center;padding:20px;">Sin mensajes todavía</div>`;
  } else {
    html += messages.map(m => {
      const isUser = m.sender_type === 'user';
      const time   = formatTime(m.created_at);
      return `<div class="modal-bubble-wrap wrap-${m.sender_type}">
        <div class="modal-bubble modal-bubble-${m.sender_type}">${escHtml(m.content)}</div>
        <div class="modal-bubble-meta">${isUser ? 'Usuario' : escHtml(m.sender_name || 'Agente')} · ${time}</div>
      </div>`;
    }).join('');
  }

  body.innerHTML = html;
  body.scrollTop = body.scrollHeight;
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('active');
  currentConvId = null;
}

async function deleteConversation() {
  if (!currentConvId) return;
  if (!confirm('¿Eliminar esta conversación y todos sus mensajes? Esta acción no se puede deshacer.')) return;

  try {
    await apiFetch(`/admin/conversations/${currentConvId}`, 'DELETE');
    closeModal();
    loadConversations(document.getElementById('searchInput').value);
    showToast('Conversación eliminada');
  } catch (err) {
    showToast(err.message, true);
  }
}

// ────────────────────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res  = await apiFetch('/admin/settings');
    const data = await res.json();

    document.getElementById('settingWebhook').value = data.n8n_webhook || '';

    // Mostrar endpoints del backend
    const base = window.location.origin.includes('localhost')
      ? 'http://localhost:3001'
      : window.location.origin;
    document.getElementById('endpointResponseUrl').textContent = `${base}/api/webhook/response`;
    document.getElementById('endpointAgentUrl').textContent    = `${base}/api/webhook/agent-message`;
  } catch { /* silencioso */ }
}

async function saveSettings() {
  const n8n_webhook = document.getElementById('settingWebhook').value.trim();
  try {
    const res = await apiFetch('/admin/settings', 'PUT', { n8n_webhook });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error);
    }
    showToast('✅ Configuración guardada');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function changePassword() {
  const currentPassword = document.getElementById('currentPass').value;
  const newPassword     = document.getElementById('newPass').value;
  const errEl           = document.getElementById('passError');
  errEl.classList.remove('visible');

  try {
    const res  = await apiFetch('/admin/password', 'PUT', { currentPassword, newPassword });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('currentPass').value = '';
    document.getElementById('newPass').value     = '';
    showToast('✅ Contraseña actualizada');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
  }
}

function copyEndpoint(elId) {
  const text = document.getElementById(elId).textContent;
  navigator.clipboard.writeText(text).then(() => showToast('Copiado al portapapeles ✓'));
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body) {
  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
  return res;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts));
}

function formatTime(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts));
}

let toastTimer = null;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'visible' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

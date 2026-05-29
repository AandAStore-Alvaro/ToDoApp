/* ============================================================
   TEAMFLOW — app.js
   ============================================================
   CONFIGURACIÓN INICIAL:
   1. Ve a https://console.firebase.google.com
   2. Crea un proyecto (o usa uno existente)
   3. Ve a "Añadir app" → Web → copia la config aquí abajo
   4. Activa Authentication → Email/Password
   5. Activa Firestore Database (modo producción)
   6. En Firestore → Reglas, copia el contenido de firestore.rules
   ============================================================ */

const firebaseConfig = {
  apiKey:            "AIzaSyDL9crHBSyXAjfLTRPon7KIyvkOXHw5sxk",
  authDomain:        "teamflow-434b6.firebaseapp.com",
  projectId:         "teamflow-434b6",
  storageBucket:     "teamflow-434b6.firebasestorage.app",
  messagingSenderId: "1009402662855",
  appId:             "1:1009402662855:web:5e4392ec753e90d18c93e2"
};

// ============================================================
// INIT
// ============================================================
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ============================================================
// STATE
// ============================================================
let state = {
  user:          null,
  userProfile:   null,
  users:         [],
  groupTasks:    [],
  personalTasks: [],
  meetings:      [],
  currentView:   'dashboard',
  currentMonth:  new Date(),
  selectedDate:  null,
  editingTaskId: null,
  editingMeetingId: null,
  filters: {
    group:    { status: '', priority: '' },
    personal: { status: '', priority: '' },
  },
};

let unsubGroupTasks    = null;
let unsubPersonalTasks = null;
let unsubMeetings      = null;


// ============================================================
// UTILS
// ============================================================
const $ = id => document.getElementById(id);

function formatDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplay(dateStr) {
  if (!dateStr) return '';
  const d = formatDate(dateStr);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = formatDate(dateStr);
  const today = new Date(); today.setHours(0,0,0,0);
  return d < today;
}

function monthName(date) {
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

const STATUS_LABEL = { todo: 'Por hacer', 'in-progress': 'En progreso', done: 'Completado' };
const PRIORITY_LABEL = { low: 'Baja', medium: 'Media', high: 'Alta' };

function authErrorMsg(code) {
  const msgs = {
    'auth/email-already-in-use': 'Este correo ya está registrado.',
    'auth/wrong-password':       'Contraseña incorrecta.',
    'auth/user-not-found':       'No existe una cuenta con este correo.',
    'auth/weak-password':        'La contraseña debe tener al menos 6 caracteres.',
    'auth/invalid-email':        'El correo electrónico no es válido.',
    'auth/invalid-credential':   'Correo o contraseña incorrectos.',
    'auth/too-many-requests':    'Demasiados intentos. Intenta más tarde.',
  };
  return msgs[code] || 'Ocurrió un error. Inténtalo de nuevo.';
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, type = 'default') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ============================================================
// AUTH
// ============================================================
async function login(email, password) {
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showAuthError('login-error', authErrorMsg(e.code));
  }
}

async function register(name, email, password) {
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await saveUserProfile({ uid: cred.user.uid, name, email });
  } catch (e) {
    showAuthError('register-error', authErrorMsg(e.code));
  }
}

async function logout() {
  teardownListeners();
  await auth.signOut();
}

function showAuthError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAuthErrors() {
  ['login-error','register-error'].forEach(id => {
    $(id).textContent = '';
    $(id).classList.add('hidden');
  });
}

// ============================================================
// USER PROFILE
// ============================================================
async function saveUserProfile({ uid, name, email }) {
  await db.collection('users').doc(uid).set({ uid, name, email, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

async function loadUsers() {
  const snap = await db.collection('users').get();
  state.users = snap.docs.map(d => d.data());
}

function getUserName(uid) {
  const u = state.users.find(u => u.uid === uid);
  return u ? u.name : 'Desconocido';
}

// ============================================================
// LISTENERS (real-time)
// ============================================================
function setupListeners() {
  // Group tasks
  unsubGroupTasks = db.collection('groupTasks')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      state.groupTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderGroupTasks();
      renderDashboard();
    });

  // Personal tasks
  unsubPersonalTasks = db.collection('users').doc(state.user.uid)
    .collection('personalTasks')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      state.personalTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPersonalTasks();
      renderDashboard();
    });

  // Meetings
  unsubMeetings = db.collection('meetings')
    .orderBy('date', 'asc')
    .onSnapshot(snap => {
      state.meetings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCalendar();
      renderMeetingsList();
      renderDashboard();
    });
}

function teardownListeners() {
  if (unsubGroupTasks) unsubGroupTasks();
  if (unsubPersonalTasks) unsubPersonalTasks();
  if (unsubMeetings) unsubMeetings();
}

// ============================================================
// GROUP TASKS CRUD
// ============================================================
async function addGroupTask(data) {
  const maxOrder = state.groupTasks.reduce((max, t) => Math.max(max, t.order ?? -1), -1);
  const ref = await db.collection('groupTasks').add({
    ...data,
    order: maxOrder + 1,
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function updateGroupTasksOrder(orderedIds) {
  const batch = db.batch();
  orderedIds.forEach((id, index) => {
    batch.update(db.collection('groupTasks').doc(id), { order: index });
  });
  await batch.commit();
}

async function updateGroupTask(id, data) {
  await db.collection('groupTasks').doc(id).update(data);
}

async function deleteGroupTask(id) {
  await db.collection('groupTasks').doc(id).delete();
}

// ============================================================
// PERSONAL TASKS CRUD
// ============================================================
async function addPersonalTask(data) {
  const maxOrder = state.personalTasks.reduce((max, t) => Math.max(max, t.order ?? -1), -1);
  const ref = await db.collection('users').doc(state.user.uid)
    .collection('personalTasks').add({
      ...data,
      order: maxOrder + 1,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  return ref.id;
}

async function updatePersonalTasksOrder(orderedIds) {
  const batch = db.batch();
  const ref = db.collection('users').doc(state.user.uid).collection('personalTasks');
  orderedIds.forEach((id, index) => {
    batch.update(ref.doc(id), { order: index });
  });
  await batch.commit();
}

async function updatePersonalTask(id, data) {
  await db.collection('users').doc(state.user.uid)
    .collection('personalTasks').doc(id).update(data);
}

async function deletePersonalTask(id) {
  await db.collection('users').doc(state.user.uid)
    .collection('personalTasks').doc(id).delete();
}

// ============================================================
// MEETINGS CRUD
// ============================================================
async function addMeeting(data) {
  await db.collection('meetings').add({
    ...data,
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function updateMeeting(id, data) {
  await db.collection('meetings').doc(id).update(data);
}

async function deleteMeeting(id) {
  await db.collection('meetings').doc(id).delete();
}

// ============================================================
// RENDER — TASK CARD
// ============================================================
function taskCardHTML(task, type, index = 0, total = 1) {
  const overdue = task.status !== 'done' && isOverdue(task.dueDate);
  const assignees = type === 'group' && task.assignees?.length
    ? task.assignees.map(uid => getUserName(uid)).filter(Boolean)
    : [];

  const dueDateHtml = task.dueDate
    ? `<span class="task-meta-item ${overdue ? 'overdue' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        ${overdue ? '⚠ ' : ''}${formatDisplay(task.dueDate)}
      </span>`
    : '';

  const assigneesHtml = assignees.length
    ? `<div class="assignee-chips">${assignees.map(n => `<span class="assignee-chip">${n}</span>`).join('')}</div>`
    : '';

  const creatorHtml = type === 'group' && task.createdBy
    ? `<span class="task-meta-item">por ${getUserName(task.createdBy)}</span>`
    : '';

  // Drag handle + número de orden (ambos tipos)
  const dragHandle = `
    <div class="drag-handle" title="Arrastra para reordenar">
      <span class="order-num">${index + 1}</span>
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" class="grip-icon">
        <circle cx="9"  cy="4"  r="1.5"/><circle cx="15" cy="4"  r="1.5"/>
        <circle cx="9"  cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
        <circle cx="9"  cy="20" r="1.5"/><circle cx="15" cy="20" r="1.5"/>
      </svg>
    </div>`;

  // Botones subir/bajar (ambos tipos)
  const orderBtns = `
    <div class="order-btns">
      <button class="order-btn move-up-btn" data-id="${task.id}" title="Subir" ${index === 0 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button class="order-btn move-down-btn" data-id="${task.id}" title="Bajar" ${index === total - 1 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>`;

  return `
    <div class="task-card priority-${task.priority} status-${task.status}"
         data-id="${task.id}" data-type="${type}" draggable="true">
      ${dragHandle}
      <div class="task-main">
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${task.desc ? `<div class="task-desc">${escapeHtml(task.desc)}</div>` : ''}
        <div class="task-meta">
          <span class="badge badge-${task.status}">${STATUS_LABEL[task.status]}</span>
          <span class="badge badge-${task.priority}">${PRIORITY_LABEL[task.priority]}</span>
          ${dueDateHtml}
          ${creatorHtml}
          ${assigneesHtml}
        </div>
      </div>
      <div class="task-actions">
        ${orderBtns}
        <button class="action-btn edit-task-btn" data-id="${task.id}" data-type="${type}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ============================================================
// RENDER — GROUP TASKS
// ============================================================
let sortedGroupIds = []; // orden actual para drag & drop

function renderGroupTasks() {
  const { status, priority } = state.filters.group;
  const filtersActive = !!(status || priority);

  // Ordenar por campo "order", sin orden asignado van al final
  let tasks = [...state.groupTasks].sort((a, b) => {
    const oa = a.order !== undefined ? a.order : 999999;
    const ob = b.order !== undefined ? b.order : 999999;
    return oa - ob;
  });

  // Guardar IDs ordenados (sin filtros, para drag & drop sobre lista completa)
  sortedGroupIds = tasks.map(t => t.id);

  if (status)   tasks = tasks.filter(t => t.status === status);
  if (priority) tasks = tasks.filter(t => t.priority === priority);

  const container = $('group-tasks-list');

  if (!tasks.length) {
    container.innerHTML = emptyState('👥', 'No hay tareas grupales.', 'Crea una para que todo el equipo pueda verla.');
    return;
  }

  container.innerHTML = tasks.map((t, i) => taskCardHTML(t, 'group', i, tasks.length)).join('');

  if (!filtersActive) {
    initGroupDragDrop(container, tasks);
  }
  bindTaskCardEvents(container, tasks, 'group');
}

// ============================================================
// RENDER — PERSONAL TASKS
// ============================================================
let sortedPersonalIds = [];

function renderPersonalTasks() {
  const { status, priority } = state.filters.personal;
  const filtersActive = !!(status || priority);

  let tasks = [...state.personalTasks].sort((a, b) => {
    const oa = a.order !== undefined ? a.order : 999999;
    const ob = b.order !== undefined ? b.order : 999999;
    return oa - ob;
  });

  sortedPersonalIds = tasks.map(t => t.id);

  if (status)   tasks = tasks.filter(t => t.status === status);
  if (priority) tasks = tasks.filter(t => t.priority === priority);

  const container = $('personal-tasks-list');
  if (!tasks.length) {
    container.innerHTML = emptyState('✅', 'No tienes tareas personales.', 'Solo tú puedes ver tus tareas personales.');
    return;
  }
  container.innerHTML = tasks.map((t, i) => taskCardHTML(t, 'personal', i, tasks.length)).join('');

  if (!filtersActive) {
    initPersonalDragDrop(container, tasks);
  }
  bindTaskCardEvents(container, tasks, 'personal');
}

function bindTaskCardEvents(container, sortedTasks = [], type = null) {
  // Editar
  container.querySelectorAll('.edit-task-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id       = btn.dataset.id;
      const taskType = btn.dataset.type;
      const task     = taskType === 'group'
        ? state.groupTasks.find(t => t.id === id)
        : state.personalTasks.find(t => t.id === id);
      openTaskModal(taskType, task);
    });
  });

  const isGroup      = type === 'group';
  const getSortedIds = () => isGroup ? [...sortedGroupIds] : [...sortedPersonalIds];
  const saveOrder    = ids => isGroup ? updateGroupTasksOrder(ids) : updatePersonalTasksOrder(ids);

  // Botón ↑ subir
  container.querySelectorAll('.move-up-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const ids = getSortedIds();
      const idx = ids.indexOf(btn.dataset.id);
      if (idx <= 0) return;
      [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
      await saveOrder(ids);
    });
  });

  // Botón ↓ bajar
  container.querySelectorAll('.move-down-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const ids = getSortedIds();
      const idx = ids.indexOf(btn.dataset.id);
      if (idx >= ids.length - 1) return;
      [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
      await saveOrder(ids);
    });
  });
}

// ============================================================
// DRAG & DROP — GROUP TASKS
// ============================================================
let dragSrcId = null;

function initGroupDragDrop(container, tasks) {
  const cards = container.querySelectorAll('.task-card[draggable="true"]');

  cards.forEach(card => {
    // Desktop drag
    card.addEventListener('dragstart', e => {
      dragSrcId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      container.querySelectorAll('.task-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const isTop = e.clientY < rect.top + rect.height / 2;
      container.querySelectorAll('.task-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      card.classList.add(isTop ? 'drag-over-top' : 'drag-over-bottom');
    });

    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      }
    });

    card.addEventListener('drop', async e => {
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      const targetId = card.dataset.id;
      if (!dragSrcId || dragSrcId === targetId) return;

      const rect = card.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      const ids = [...sortedGroupIds];
      const srcIdx = ids.indexOf(dragSrcId);
      ids.splice(srcIdx, 1);
      const tgtIdx = ids.indexOf(targetId);
      ids.splice(insertBefore ? tgtIdx : tgtIdx + 1, 0, dragSrcId);

      dragSrcId = null;
      await updateGroupTasksOrder(ids);
    });
  });
}

function initPersonalDragDrop(container, tasks) {
  const cards = container.querySelectorAll('.task-card[draggable="true"]');

  cards.forEach(card => {
    card.addEventListener('dragstart', e => {
      dragSrcId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      container.querySelectorAll('.task-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const isTop = e.clientY < rect.top + rect.height / 2;
      container.querySelectorAll('.task-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      card.classList.add(isTop ? 'drag-over-top' : 'drag-over-bottom');
    });

    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      }
    });

    card.addEventListener('drop', async e => {
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      const targetId = card.dataset.id;
      if (!dragSrcId || dragSrcId === targetId) return;

      const rect = card.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      const ids = [...sortedPersonalIds];
      const srcIdx = ids.indexOf(dragSrcId);
      ids.splice(srcIdx, 1);
      const tgtIdx = ids.indexOf(targetId);
      ids.splice(insertBefore ? tgtIdx : tgtIdx + 1, 0, dragSrcId);

      dragSrcId = null;
      await updatePersonalTasksOrder(ids);
    });
  });
}

// ============================================================
// RENDER — DASHBOARD
// ============================================================
function renderDashboard() {
  const allTasks   = [...state.groupTasks, ...state.personalTasks];
  const today = toDateStr(new Date());

  $('stat-group-tasks').textContent = state.groupTasks.length;
  $('stat-my-tasks').textContent    = state.personalTasks.length;
  $('stat-completed').textContent   = allTasks.filter(t => t.status === 'done').length;

  const thisMonth = state.currentMonth.getMonth();
  const thisYear  = state.currentMonth.getFullYear();
  const monthMeetings = state.meetings.filter(m => {
    const d = new Date(m.date + 'T00:00:00');
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  $('stat-meetings').textContent = monthMeetings.length;

  const greeting = state.userProfile?.name || state.user?.displayName || 'Equipo';
  $('dashboard-greeting').textContent = `Hola, ${greeting.split(' ')[0]} 👋`;

  // Pending tasks (not done, closest due date)
  const pending = allTasks
    .filter(t => t.status !== 'done')
    .sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1)
    .slice(0, 6);

  const tasksList = $('dashboard-tasks-list');
  tasksList.innerHTML = pending.length
    ? pending.map(t => `
        <div class="mini-task-card">
          <div class="mini-priority-dot dot-${t.priority}"></div>
          <div class="mini-task-title">${escapeHtml(t.title)}</div>
          ${t.dueDate ? `<span style="font-size:11px;color:var(--gray-400)">${formatDisplay(t.dueDate)}</span>` : ''}
        </div>`).join('')
    : `<div class="empty-state" style="padding:20px"><p>¡Todo al día! 🎉</p></div>`;

  // Upcoming meetings
  const upcoming = state.meetings
    .filter(m => m.date >= today)
    .slice(0, 5);

  const meetingsList = $('dashboard-meetings-list');
  meetingsList.innerHTML = upcoming.length
    ? upcoming.map(m => `
        <div class="mini-meeting-item">
          <div class="mini-meeting-date">${formatDisplay(m.date)}</div>
          <div>
            <div class="mini-meeting-title">${escapeHtml(m.title)}</div>
            <div class="mini-meeting-time">${m.time} · ${m.duration} min</div>
          </div>
        </div>`).join('')
    : `<div class="empty-state" style="padding:20px"><p>No hay reuniones próximas.</p></div>`;
}

// ============================================================
// RENDER — CALENDAR
// ============================================================
function renderCalendar() {
  const month = state.currentMonth.getMonth();
  const year  = state.currentMonth.getFullYear();

  $('calendar-month-year').textContent = monthName(state.currentMonth);

  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // make Mon=0

  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const daysInPrev   = new Date(year, month, 0).getDate();
  const todayStr     = toDateStr(new Date());

  // Build set of dates that have meetings
  const meetingDates = {};
  state.meetings.forEach(m => {
    if (!meetingDates[m.date]) meetingDates[m.date] = 0;
    meetingDates[m.date]++;
  });

  let html = '';

  // Prev month filler days
  for (let i = startDow - 1; i >= 0; i--) {
    html += `<div class="calendar-day other-month"><div class="day-num">${daysInPrev - i}</div></div>`;
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday    = dateStr === todayStr;
    const isSelected = dateStr === state.selectedDate;
    const count      = meetingDates[dateStr] || 0;

    const dots = count > 0
      ? `<div class="day-dots">${Array(Math.min(count, 3)).fill('<div class="day-dot"></div>').join('')}</div>`
      : '';

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}"
           data-date="${dateStr}">
        <div class="day-num">${d}</div>
        ${dots}
      </div>`;
  }

  // Next month filler
  const totalCells = startDow + daysInMonth;
  const remainder  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remainder; d++) {
    html += `<div class="calendar-day other-month"><div class="day-num">${d}</div></div>`;
  }

  $('calendar-days').innerHTML = html;

  // Bind day clicks
  $('calendar-days').querySelectorAll('.calendar-day:not(.other-month)').forEach(el => {
    el.addEventListener('click', () => {
      const date = el.dataset.date;
      if (state.selectedDate === date) {
        state.selectedDate = null;
        $('selected-date-title').textContent = 'Todas las reuniones';
        $('clear-date-filter').style.display = 'none';
      } else {
        state.selectedDate = date;
        $('selected-date-title').textContent = formatDisplay(date);
        $('clear-date-filter').style.display = '';
      }
      renderCalendar();
      renderMeetingsList();
    });
  });
}

// ============================================================
// RENDER — MEETINGS LIST
// ============================================================
function renderMeetingsList() {
  let meetings = [...state.meetings];

  if (state.selectedDate) {
    meetings = meetings.filter(m => m.date === state.selectedDate);
  } else {
    meetings.sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1);
  }

  const container = $('meetings-list');
  if (!meetings.length) {
    container.innerHTML = emptyState('📅', 'No hay reuniones.', 'Haz clic en "+ Nueva Reunión" para añadir una.');
    return;
  }

  container.innerHTML = meetings.map(m => {
    const durationStr = m.duration >= 60
      ? `${Math.floor(m.duration/60)}h${m.duration%60 ? ` ${m.duration%60}min` : ''}`
      : `${m.duration}min`;

    const linkHtml = m.link
      ? `<a class="meeting-link-btn" href="${escapeHtml(m.link)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          ${escapeHtml(m.link)}
        </a>`
      : '';

    return `
      <div class="meeting-item" data-id="${m.id}">
        <div class="meeting-item-header">
          <div class="meeting-title">${escapeHtml(m.title)}</div>
          <div class="task-actions">
            <button class="action-btn edit-meeting-btn" data-id="${m.id}" title="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="meeting-datetime">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          ${formatDisplay(m.date)} a las ${m.time} · ${durationStr}
        </div>
        ${m.desc ? `<div class="meeting-desc">${escapeHtml(m.desc)}</div>` : ''}
        ${linkHtml}
        <div style="font-size:11px;color:var(--gray-400);margin-top:4px">
          Creado por ${getUserName(m.createdBy)}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.edit-meeting-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const meeting = state.meetings.find(m => m.id === btn.dataset.id);
      openMeetingModal(meeting);
    });
  });
}

// ============================================================
// EMPTY STATE HELPER
// ============================================================
function emptyState(icon, title, subtitle) {
  return `<div class="empty-state">
    <span class="empty-state-icon">${icon}</span>
    <p><strong>${title}</strong></p>
    <p style="margin-top:4px">${subtitle}</p>
  </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// TASK MODAL
// ============================================================
async function openTaskModal(type, task = null) {
  state.editingTaskId = task?.id || null;

  $('task-modal-title').textContent = task ? 'Editar Tarea' : 'Nueva Tarea';
  $('task-id').value       = task?.id || '';
  $('task-type').value     = type;
  $('task-title').value    = task?.title || '';
  $('task-desc').value     = task?.desc || '';
  $('task-priority').value = task?.priority || 'medium';
  $('task-status').value   = task?.status || 'todo';
  $('task-due-date').value = task?.dueDate || '';

  const assigneesGroup = $('task-assignees-group');
  const deleteBtn      = $('delete-task-btn');

  if (type === 'group') {
    assigneesGroup.style.display = '';
    await loadUsers();
    renderAssigneesCheckboxes(task?.assignees || []);
  } else {
    assigneesGroup.style.display = 'none';
  }

  deleteBtn.classList.toggle('hidden', !task);

  $('task-modal').classList.remove('hidden');
  $('task-title').focus();
}

function renderAssigneesCheckboxes(selectedUids) {
  const container = $('task-assignees-list');
  if (!state.users.length) {
    container.innerHTML = '<span class="assignees-loading">No hay usuarios registrados.</span>';
    return;
  }
  container.innerHTML = state.users.map(u => `
    <label class="assignee-check">
      <input type="checkbox" value="${u.uid}" ${selectedUids.includes(u.uid) ? 'checked' : ''}>
      ${escapeHtml(u.name)}
      ${u.uid === state.user.uid ? '<span style="color:var(--gray-400)"> (tú)</span>' : ''}
    </label>`).join('');
}

async function saveTask() {
  const title = $('task-title').value.trim();
  const type  = $('task-type').value;
  const id    = $('task-id').value;

  if (!title) { toast('El título es obligatorio.', 'error'); return; }

  const data = {
    title,
    desc:     $('task-desc').value.trim(),
    priority: $('task-priority').value,
    status:   $('task-status').value,
    dueDate:  $('task-due-date').value || null,
  };

  if (type === 'group') {
    const checked = [...$('task-assignees-list').querySelectorAll('input[type=checkbox]:checked')];
    data.assignees = checked.map(c => c.value);
  }

  try {
    if (id) {
      type === 'group' ? await updateGroupTask(id, data) : await updatePersonalTask(id, data);
      toast('Tarea actualizada.', 'success');
    } else {
      type === 'group' ? await addGroupTask(data) : await addPersonalTask(data);
      toast('Tarea creada.', 'success');
    }
    closeModal('task-modal');
  } catch (e) {
    toast('Error al guardar la tarea.', 'error');
    console.error(e);
  }
}

async function handleDeleteTask() {
  const id   = $('task-id').value;
  const type = $('task-type').value;
  if (!id) return;
  if (!confirm('¿Eliminar esta tarea?')) return;

  try {
    type === 'group' ? await deleteGroupTask(id) : await deletePersonalTask(id);
    toast('Tarea eliminada.', 'success');
    closeModal('task-modal');
  } catch (e) {
    toast('Error al eliminar la tarea.', 'error');
  }
}

// ============================================================
// MEETING MODAL
// ============================================================
function openMeetingModal(meeting = null, prefilledDate = null) {
  state.editingMeetingId = meeting?.id || null;

  $('meeting-modal-title').textContent = meeting ? 'Editar Reunión' : 'Nueva Reunión';
  $('meeting-id').value       = meeting?.id || '';
  $('meeting-title').value    = meeting?.title || '';
  $('meeting-desc').value     = meeting?.desc || '';
  $('meeting-date').value     = meeting?.date || prefilledDate || '';
  $('meeting-time').value     = meeting?.time || '';
  $('meeting-duration').value = meeting?.duration || '60';
  $('meeting-link').value     = meeting?.link || '';

  $('delete-meeting-btn').classList.toggle('hidden', !meeting);
  $('meeting-modal').classList.remove('hidden');
  $('meeting-title').focus();
}

async function saveMeeting() {
  const title = $('meeting-title').value.trim();
  const date  = $('meeting-date').value;
  const time  = $('meeting-time').value;
  const id    = $('meeting-id').value;

  if (!title) { toast('El título es obligatorio.', 'error'); return; }
  if (!date)  { toast('La fecha es obligatoria.', 'error'); return; }
  if (!time)  { toast('La hora es obligatoria.', 'error'); return; }

  const data = {
    title,
    desc:     $('meeting-desc').value.trim(),
    date,
    time,
    duration: Number($('meeting-duration').value),
    link:     $('meeting-link').value.trim(),
  };

  try {
    if (id) {
      await updateMeeting(id, data);
      toast('Reunión actualizada.', 'success');
    } else {
      await addMeeting(data);
      toast('Reunión creada.', 'success');
    }
    closeModal('meeting-modal');
  } catch (e) {
    toast('Error al guardar la reunión.', 'error');
    console.error(e);
  }
}

async function handleDeleteMeeting() {
  const id = $('meeting-id').value;
  if (!id) return;
  if (!confirm('¿Eliminar esta reunión?')) return;

  try {
    await deleteMeeting(id);
    toast('Reunión eliminada.', 'success');
    closeModal('meeting-modal');
  } catch (e) {
    toast('Error al eliminar la reunión.', 'error');
  }
}

// ============================================================
// MODAL HELPERS
// ============================================================
function closeModal(id) {
  $(id).classList.add('hidden');
}

// ============================================================
// MOBILE MENU
// ============================================================
function openMobileMenu() {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('visible');
  document.body.style.overflow = '';
}

function toggleMobileMenu() {
  $('sidebar').classList.contains('open') ? closeMobileMenu() : openMobileMenu();
}

// ============================================================
// VIEW SWITCHING
// ============================================================
function showView(view) {
  state.currentView = view;
  const views = ['dashboard', 'group-tasks', 'my-tasks', 'calendar'];
  views.forEach(v => {
    $(`${v}-view`).classList.toggle('hidden', v !== view);
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'calendar') {
    renderCalendar();
    renderMeetingsList();
  }
}

// ============================================================
// AUTH STATE CHANGE
// ============================================================
auth.onAuthStateChanged(async user => {
  if (user) {
    state.user = user;
    // Ensure user profile in Firestore
    if (user.displayName) {
      await saveUserProfile({ uid: user.uid, name: user.displayName, email: user.email });
    }
    // Load users for assignees
    await loadUsers();
    state.userProfile = state.users.find(u => u.uid === user.uid);

    // Update sidebar
    const name = user.displayName || user.email;
    $('sidebar-avatar').textContent = name.charAt(0).toUpperCase();
    $('sidebar-name').textContent   = user.displayName || 'Usuario';
    $('sidebar-email').textContent  = user.email;

    // Show app
    $('auth-screen').classList.add('hidden');
    $('main-app').classList.remove('hidden');

    setupListeners();
    renderDashboard();
    showView('dashboard');
  } else {
    state.user = null;
    state.groupTasks = [];
    state.personalTasks = [];
    state.meetings = [];
    $('main-app').classList.add('hidden');
    $('auth-screen').classList.remove('hidden');
    hideAuthErrors();
  }
});

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      $('login-form').classList.toggle('hidden', which !== 'login');
      $('register-form').classList.toggle('hidden', which !== 'register');
      hideAuthErrors();
    });
  });

  // Login form
  $('login-form').addEventListener('submit', e => {
    e.preventDefault();
    login($('login-email').value.trim(), $('login-password').value);
  });

  // Register form
  $('register-form').addEventListener('submit', e => {
    e.preventDefault();
    register($('reg-name').value.trim(), $('reg-email').value.trim(), $('reg-password').value);
  });

  // Logout
  $('logout-btn').addEventListener('click', logout);

  // Nav items
  document.querySelectorAll('.nav-item, [data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view) showView(btn.dataset.view);
    });
  });

  // Add group task
  $('add-group-task-btn').addEventListener('click', () => openTaskModal('group'));

  // Add personal task
  $('add-personal-task-btn').addEventListener('click', () => openTaskModal('personal'));

  // Add meeting
  $('add-meeting-btn').addEventListener('click', () => openMeetingModal());

  // Save task
  $('save-task-btn').addEventListener('click', saveTask);

  // Delete task
  $('delete-task-btn').addEventListener('click', handleDeleteTask);

  // Save meeting
  $('save-meeting-btn').addEventListener('click', saveMeeting);

  // Delete meeting
  $('delete-meeting-btn').addEventListener('click', handleDeleteMeeting);

  // Calendar navigation
  $('prev-month').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1);
    state.selectedDate = null;
    $('selected-date-title').textContent = 'Todas las reuniones';
    $('clear-date-filter').style.display = 'none';
    renderCalendar();
    renderMeetingsList();
    renderDashboard();
  });

  $('next-month').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1);
    state.selectedDate = null;
    $('selected-date-title').textContent = 'Todas las reuniones';
    $('clear-date-filter').style.display = 'none';
    renderCalendar();
    renderMeetingsList();
    renderDashboard();
  });

  // Clear date filter
  $('clear-date-filter').addEventListener('click', () => {
    state.selectedDate = null;
    $('selected-date-title').textContent = 'Todas las reuniones';
    $('clear-date-filter').style.display = 'none';
    renderCalendar();
    renderMeetingsList();
  });

  // Close modals (backdrop + X + cancel buttons)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    if (btn.dataset.modal) btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  // Filters
  $('group-status-filter').addEventListener('change', e => {
    state.filters.group.status = e.target.value;
    renderGroupTasks();
  });
  $('group-priority-filter').addEventListener('change', e => {
    state.filters.group.priority = e.target.value;
    renderGroupTasks();
  });
  $('personal-status-filter').addEventListener('change', e => {
    state.filters.personal.status = e.target.value;
    renderPersonalTasks();
  });
  $('personal-priority-filter').addEventListener('change', e => {
    state.filters.personal.priority = e.target.value;
    renderPersonalTasks();
  });

  // Keyboard ESC to close modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['task-modal','meeting-modal'].forEach(id => {
        if (!$(id).classList.contains('hidden')) closeModal(id);
      });
      closeMobileMenu();
    }
  });

  // Hamburger menu
  $('hamburger-btn').addEventListener('click', toggleMobileMenu);
  $('sidebar-overlay').addEventListener('click', closeMobileMenu);

  // Cerrar menú al navegar en móvil
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMobileMenu();
    });
  });
});

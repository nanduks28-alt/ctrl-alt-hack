

import {
  supabase,
  saveIncident,
  updateIncident,
  savePostmortem,
  fetchIncidents,
  fetchPostmortems,
  subscribeToIncidents,
  sendOtp,
  verifyOtp,
  getSession,
  signOut,
  saveProject,
  fetchProjects,
  deleteProject,
  verifyGithubOwnership,
} from './supabase.js'

/* ─────────────────────────────────────────────
   SECTION 1: STATE
───────────────────────────────────────────── */
const state = {
  activeIncident: null,
  bobCredits: 2,
  bobCreditsMax: 40,
  incidentCounter: 1,
  postmortems: [],
  bobAnalysisDone: false,
  currentUser: null,
  projects: [],
};

/* ─────────────────────────────────────────────
   SECTION 2: SERVICE DATA
───────────────────────────────────────────── */
const services = [
  { id: 'payment-api',          status: 'healthy', uptime: '99.98%', responseTime: '134ms' },
  { id: 'auth-service',         status: 'healthy', uptime: '99.99%', responseTime: '89ms'  },
  { id: 'order-service',        status: 'healthy', uptime: '99.95%', responseTime: '201ms' },
  { id: 'notification-service', status: 'healthy', uptime: '99.91%', responseTime: '312ms' },
  { id: 'user-db',              status: 'healthy', uptime: '100%',   responseTime: '45ms'  },
  { id: 'cache-layer',          status: 'healthy', uptime: '99.99%', responseTime: '12ms'  },
];

/* ─────────────────────────────────────────────
   SECTION 3: FAKE HISTORICAL POSTMORTEMS
───────────────────────────────────────────── */
const historicalPostmortems = [
  {
    id: 'INC-0042',
    service: 'auth-service',
    date: '2025-05-10',
    rootCause: 'JWT secret rotation caused token validation failures',
    status: 'resolved',
    timeline: [
      { time: '02:14', event: 'Alert triggered — auth-service returning 401 for all requests' },
      { time: '02:15', event: 'Auto-restart attempted — no effect' },
      { time: '02:17', event: 'Escalated to Bob AI for analysis' },
      { time: '02:19', event: 'Root cause identified: JWT secret mismatch after rotation' },
      { time: '02:22', event: 'Fix applied — secret re-synced across all nodes' },
      { time: '02:24', event: 'Incident resolved. Service restored.' },
    ],
    rca: 'During a scheduled secret rotation, the new JWT signing secret was deployed to the auth-service but not propagated to the token validation middleware. This caused all incoming tokens signed with the old secret to fail validation, resulting in a complete authentication outage.',
    prevention: [
      'Implement atomic secret rotation that updates all consumers simultaneously',
      'Add integration tests that validate token round-trips after secret rotation',
      'Set up canary deployments for secret rotation procedures',
      'Add monitoring alert for sudden spike in 401 response codes',
    ],
  },
  {
    id: 'INC-0038',
    service: 'user-db',
    date: '2025-04-28',
    rootCause: 'Unindexed query caused full table scan under load',
    status: 'resolved',
    timeline: [
      { time: '14:03', event: 'Response time spike detected on user-db (>2000ms)' },
      { time: '14:04', event: 'Auto-scaling triggered — no improvement' },
      { time: '14:06', event: 'Escalated to Bob AI' },
      { time: '14:08', event: 'Bob identified slow query: SELECT * FROM users WHERE email LIKE' },
      { time: '14:11', event: 'Index added on email column' },
      { time: '14:12', event: 'Response times normalized. Incident resolved.' },
    ],
    rca: 'A new feature deployment introduced a user lookup query using a LIKE operator on the email column without a corresponding index. Under normal load this was acceptable, but a marketing campaign tripled traffic and caused the query to perform full table scans on a 4M-row table.',
    prevention: [
      'Enforce query review checklist before merging features that touch database queries',
      'Add automated slow query detection in CI pipeline using EXPLAIN ANALYZE',
      'Set up query performance regression tests in staging with production-scale data',
      'Implement query timeout limits to prevent cascading failures',
    ],
  },
];

/* ─────────────────────────────────────────────
   SECTION 4: NAVIGATION
───────────────────────────────────────────── */
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });
}

function navigateTo(pageId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  const page    = document.getElementById(`page-${pageId}`);
  if (navItem) navItem.classList.add('active');
  if (page)    page.classList.add('active');
}

/* ─────────────────────────────────────────────
   SECTION 5: LIVE CLOCK
───────────────────────────────────────────── */
function initClock() {
  function tick() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const str = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    document.getElementById('live-clock').textContent = str;
  }
  tick();
  setInterval(tick, 1000);
}

/* ─────────────────────────────────────────────
   SECTION 6: SERVICE GRID
───────────────────────────────────────────── */
function renderServiceGrid() {
  const grid = document.getElementById('service-grid');
  const meta = document.getElementById('health-meta');
  grid.innerHTML = '';

  const hasProjects = state.projects && state.projects.length > 0;

  if (!hasProjects) {
    grid.innerHTML = `
      <div style="grid-column:1/-1; display:flex; flex-direction:column; align-items:center;
                  justify-content:center; gap:10px; padding:40px 20px; color:var(--text-muted);">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2a2a30"
             stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span style="font-size:13px; color:var(--text-dim); font-weight:600;">No projects added yet.</span>
        <span style="font-size:12px;">Go to <strong style="color:var(--blue)">My Projects</strong> to register your first repo.</span>
      </div>
    `;
    if (meta) meta.textContent = '0 services monitored';
    return;
  }

  if (meta) meta.textContent = `${state.projects.length} service${state.projects.length !== 1 ? 's' : ''} monitored`;

  state.projects.forEach(proj => {
    if (!proj._status)       proj._status       = 'healthy';
    if (!proj._uptime)       proj._uptime       = (99 + Math.random()).toFixed(2) + '%';
    if (!proj._responseTime) proj._responseTime = (Math.floor(Math.random() * 300) + 50) + 'ms';

    const card = document.createElement('div');
    card.className = `service-card ${proj._status !== 'healthy' ? proj._status : ''}`;
    card.id = `svc-${proj.id}`;
    card.innerHTML = `
      <div class="service-name">${escapeHtml(proj.name)}</div>
      <span class="status-badge ${proj._status}">${proj._status.toUpperCase()}</span>
      <div class="service-stats">
        <span>Uptime <span class="service-stat-val">${proj._uptime}</span></span>
        <span>Resp <span class="service-stat-val">${proj._responseTime}</span></span>
      </div>
    `;

    // Click → open project overview panel
    card.addEventListener('click', () => openProjectOverview(proj));
    grid.appendChild(card);
  });
}

/* ─────────────────────────────────────────────
   SECTION 7: ACTIVITY LOG
───────────────────────────────────────────── */
function addLogEntry(message, type = 'info') {
  const log = document.getElementById('activity-log');
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts  = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `${ts} — ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function initActivityLog() {
  addLogEntry('System initialized. All services nominal.', 'ok');
  addLogEntry('Bob AI engine connected. Credits: 2/40.', 'info');
}

/* ─────────────────────────────────────────────
   SECTION 8: SIMULATE INCIDENT
───────────────────────────────────────────── */
function initSimulateButton() {
  document.getElementById('simulate-btn').addEventListener('click', simulateIncident);
}

function simulateIncident() {
  if (state.activeIncident) {
    addLogEntry('Cannot simulate: an incident is already active.', 'warn');
    return;
  }
  if (!state.projects || state.projects.length === 0) {
    addLogEntry('Add a project first before simulating an incident.', 'warn');
    navigateTo('projects');
    return;
  }

  const proj    = state.projects[Math.floor(Math.random() * state.projects.length)];
  const svcName = proj.name;
  const now     = new Date();
  const pad     = n => String(n).padStart(2, '0');
  const ts      = () => {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const incidentId = `INC-${String(state.incidentCounter).padStart(4, '0')}`;
  state.incidentCounter++;

  state.activeIncident = {
    id: incidentId,
    service: svcName,
    errorType: 'Connection timeout / Pool exhausted',
    severity: 'CRITICAL',
    startTime: now.toLocaleString(),
    tl1: ts(),
    tl2: null,
    tl3: null,
    tl4: null,
    resolved: false,
    engineerTookControl: false,
  };

  saveIncident({
    id:         state.activeIncident.id,
    service:    state.activeIncident.service,
    error_type: state.activeIncident.errorType,
    severity:   state.activeIncident.severity,
    status:     'active',
    started_at: now.toISOString(),
    logs:       null,
    commits:    null,
  });

  proj._status = 'critical';
  renderServiceGrid();
  updateStatCards();
  addLogEntry(`ALERT: ${svcName} is down — connection pool exhausted`, 'alert');

  setTimeout(() => {
    state.activeIncident.tl2 = ts();
    addLogEntry(`Auto-restart triggered for ${svcName}`, 'warn');
  }, 1000);

  setTimeout(() => {
    addLogEntry(`Restart failed. Service ${svcName} still unresponsive.`, 'alert');
  }, 2000);

  setTimeout(() => {
    state.activeIncident.tl3 = ts();
    addLogEntry(`Escalating to Bob AI for root cause analysis...`, 'info');
    document.getElementById('incident-badge').style.display = 'inline';
    navigateTo('incidents');
    renderIncidentCard();
    fillBobContext();
    triggerBobAnalysis();
  }, 3000);
}

/* ─────────────────────────────────────────────
   SECTION 9: STAT CARDS
───────────────────────────────────────────── */
function updateStatCards() {
  const inc     = state.activeIncident;
  const total   = state.projects.length || 0;
  const healthy = state.projects.filter(p => !p._status || p._status === 'healthy').length;

  if (inc && !inc.resolved) {
    document.getElementById('stat-incidents').textContent = '1';
    document.getElementById('stat-incidents').className = 'stat-value red';
    document.getElementById('stat-incidents-sub').textContent = `${inc.id} active`;
    document.getElementById('stat-services').textContent = `${healthy} / ${total}`;
    document.getElementById('stat-services').className = 'stat-value red';
  } else {
    document.getElementById('stat-incidents').textContent = '0';
    document.getElementById('stat-incidents').className = 'stat-value green';
    document.getElementById('stat-incidents-sub').textContent = 'No active incidents';
    document.getElementById('stat-services').textContent = total > 0 ? `${total} / ${total}` : '—';
    document.getElementById('stat-services').className = 'stat-value green';
  }

  const pct = Math.round((state.bobCredits / state.bobCreditsMax) * 100);
  document.getElementById('stat-credits').textContent = `${state.bobCredits} / ${state.bobCreditsMax}`;
  document.getElementById('credits-text').textContent = `${state.bobCredits} / ${state.bobCreditsMax}`;
  document.getElementById('credits-fill').style.width = `${pct}%`;
}

/* ─────────────────────────────────────────────
   SECTION 10: INCIDENT CARD
───────────────────────────────────────────── */
function renderIncidentCard() {
  const inc = state.activeIncident;
  if (!inc) return;

  document.getElementById('incidents-empty').style.display = 'none';
  const card = document.getElementById('incident-card');
  card.style.display = 'block';

  document.getElementById('inc-id').textContent       = inc.id;
  document.getElementById('inc-severity').textContent = inc.severity;
  document.getElementById('inc-service').textContent  = inc.service;
  document.getElementById('inc-error').textContent    = inc.errorType;
  document.getElementById('inc-time').textContent     = inc.startTime;
  document.getElementById('inc-status-text').textContent = 'Escalated to Bob';

  document.getElementById('tl-1-time').textContent = inc.tl1 || '—';
  document.getElementById('tl-2-time').textContent = inc.tl2 || '—';
  document.getElementById('tl-3-time').textContent = inc.tl3 || '—';
  document.getElementById('tl-4-time').textContent = '—';

  ['tl-1','tl-2','tl-3','tl-4'].forEach(id => {
    document.getElementById(id).className = 'timeline-item';
  });
  document.getElementById('tl-1').classList.add('completed');
  document.getElementById('tl-2').classList.add('completed');
  document.getElementById('tl-3').classList.add('active');
}

/* ─────────────────────────────────────────────
   SECTION 11: BOB CONTEXT
───────────────────────────────────────────── */
function fillBobContext() {
  const inc = state.activeIncident;
  if (!inc) return;

  document.getElementById('bob-service').textContent = inc.service;
  document.getElementById('bob-error').textContent   = inc.errorType;

  const fakeLogs = [
    `[ERROR] ${inc.service}: FATAL connection pool exhausted (max=100)`,
    `[ERROR] ${inc.service}: Timeout waiting for connection after 30000ms`,
    `[WARN]  ${inc.service}: Queue depth: 847 pending requests`,
    `[ERROR] ${inc.service}: DB connection refused — too many clients`,
    `[INFO]  ${inc.service}: Attempting graceful restart...`,
    `[ERROR] ${inc.service}: Restart failed — process exited with code 1`,
    `[WARN]  ${inc.service}: Health check failing for 3 consecutive intervals`,
  ];
  document.getElementById('bob-logs').innerHTML = fakeLogs.join('<br>');

  const commits = [
    { hash: 'a3f9c12', msg: 'feat: increase DB pool size to 100 for scale', author: 'dev-team', time: '2h ago' },
    { hash: 'b7e2d45', msg: 'fix: update connection timeout from 10s to 30s', author: 'ops-team', time: '5h ago' },
    { hash: 'c1a8f67', msg: 'chore: bump pg driver to v8.11.3', author: 'dependabot', time: '1d ago' },
  ];
  document.getElementById('bob-commits').innerHTML = commits.map(c => `
    <div class="commit-item">
      <div class="commit-hash">${c.hash}</div>
      <div class="commit-msg">${c.msg}</div>
      <div class="commit-meta">${c.author} · ${c.time}</div>
    </div>
  `).join('');

  document.getElementById('bob-actions').innerHTML = `
    <div class="action-item">✗ Restart attempted: Failed (exit code 1)</div>
    <div class="action-item">✗ Rollback attempted: Failed (no prior healthy snapshot)</div>
  `;
}

/* ─────────────────────────────────────────────
   SECTION 12: BOB ANALYSIS
───────────────────────────────────────────── */
function triggerBobAnalysis() {
  state.bobAnalysisDone = false;
  document.getElementById('bob-empty').style.display   = 'none';
  document.getElementById('bob-result').style.display  = 'none';
  document.getElementById('bob-loading').style.display = 'flex';

  state.bobCredits++;
  updateStatCards();

  setTimeout(() => {
    document.getElementById('bob-loading').style.display = 'none';
    const result = document.getElementById('bob-result');
    result.style.display = 'block';

    document.getElementById('bob-root-cause').textContent =
      'Database connection pool exhausted. Max connections (100) reached due to recent pool size increase combined with a traffic spike. Connections are not being released properly.';
    document.getElementById('bob-fix').textContent =
      'Reduce pool size from 100 to 50 and restart the connection manager. Audit connection release logic in the query handler — suspected missing .release() call in error path.';
    document.getElementById('bob-risk').textContent = 'LOW';
    document.getElementById('bob-risk').className   = 'risk-badge low';

    setTimeout(() => {
      document.getElementById('bob-confidence-fill').style.width = '91%';
      document.getElementById('bob-confidence-pct').textContent  = '91%';
    }, 100);

    state.bobAnalysisDone = true;
    addLogEntry('Bob analysis complete. Root cause identified.', 'ok');
  }, 2000);
}

/* ─────────────────────────────────────────────
   SECTION 13: INCIDENT ACTIONS
───────────────────────────────────────────── */
function initIncidentActions() {
  document.getElementById('take-control-btn').addEventListener('click', () => {
    if (!state.activeIncident) return;
    state.activeIncident.engineerTookControl = true;
    addLogEntry('Engineer took manual control of the incident.', 'warn');
    document.getElementById('inc-status-text').textContent = 'Engineer in control';
    updateIncident(state.activeIncident.id, { status: 'engineer_control' });
  });

  document.getElementById('view-bob-btn').addEventListener('click', () => {
    navigateTo('bob');
  });
}

/* ─────────────────────────────────────────────
   SECTION 14: GENERATE POSTMORTEM
───────────────────────────────────────────── */
function initGeneratePostmortem() {
  document.getElementById('gen-postmortem-btn').addEventListener('click', () => {
    if (!state.activeIncident) return;

    const inc = state.activeIncident;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts  = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    inc.resolved = true;
    inc.tl4 = ts;
    state.activeIncident = null;

    updateIncident(inc.id, {
      status:        'resolved',
      resolved_at:   now.toISOString(),
      root_cause:    'Database connection pool exhausted. Max connections reached.',
      suggested_fix: 'Reduce pool size from 100 to 50 and restart the connection manager.',
      confidence:    91,
    });

    const proj = state.projects.find(p => p.name === inc.service);
    if (proj) proj._status = 'healthy';

    renderServiceGrid();
    updateStatCards();
    document.getElementById('incident-badge').style.display = 'none';
    document.getElementById('tl-4').className = 'timeline-item resolved';
    document.getElementById('tl-4-time').textContent = ts;
    document.getElementById('tl-3').className = 'timeline-item completed';
    document.getElementById('inc-status-text').textContent = 'Resolved';

    const pm = {
      id: inc.id,
      service: inc.service,
      date: now.toISOString().split('T')[0],
      rootCause: 'Database connection pool exhausted. Max connections reached.',
      status: 'resolved',
      timeline: [
        { time: inc.tl1, event: `Alert triggered — ${inc.service} connection pool exhausted` },
        { time: inc.tl2, event: 'Auto-restart attempted — failed (exit code 1)' },
        { time: inc.tl3, event: 'Escalated to Bob AI for root cause analysis' },
        { time: ts,      event: 'Fix applied. Service restored. Incident resolved.' },
      ],
      rca: 'Database connection pool exhausted due to pool size increase from 50 to 100 combined with a traffic spike. Connections were not being released in the error path of the query handler, causing pool depletion under load.',
      prevention: [
        'Revert DB pool size to 50 and implement dynamic pool scaling based on load',
        'Audit all query handlers for missing .release() calls in error paths',
        'Add connection pool utilization alert at 80% threshold',
        'Implement circuit breaker pattern to prevent cascading failures',
        'Add load testing to CI pipeline to catch pool exhaustion before production',
      ],
    };

    state.postmortems.unshift(pm);
    renderPostmortemTable();

    savePostmortem({
      incident_id:        pm.id,
      service:            pm.service,
      root_cause:         pm.rootCause,
      timeline:           pm.timeline,
      prevention_actions: pm.prevention,
      created_at:         now.toISOString(),
    });

    addLogEntry(`Postmortem generated for ${inc.id}. Incident resolved.`, 'ok');
    navigateTo('postmortem');
  });
}

/* ─────────────────────────────────────────────
   SECTION 15: POSTMORTEM TABLE
───────────────────────────────────────────── */
function renderPostmortemTable() {
  const tbody = document.getElementById('postmortem-tbody');
  tbody.innerHTML = '';
  const all = [...state.postmortems, ...historicalPostmortems];
  all.forEach((pm, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;
    tr.innerHTML = `
      <td style="font-family:'Courier New',monospace; color:var(--blue)">${pm.id}</td>
      <td style="font-family:'Courier New',monospace">${pm.service}</td>
      <td>${pm.date}</td>
      <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${pm.rootCause}</td>
      <td><span class="pm-status ${pm.status}">${pm.status.toUpperCase()}</span></td>
    `;
    tr.addEventListener('click', () => expandPostmortem(pm, tr));
    tbody.appendChild(tr);
  });
}

function expandPostmortem(pm, row) {
  document.querySelectorAll('#postmortem-tbody tr').forEach(r => r.classList.remove('selected'));
  row.classList.add('selected');

  const detail = document.getElementById('postmortem-detail');
  detail.style.display = 'block';
  document.getElementById('pm-detail-title').textContent = `Postmortem: ${pm.id}`;

  document.getElementById('pm-timeline').innerHTML = pm.timeline.map(t => `
    <div class="pm-timeline-entry">
      <span class="pm-tl-time">${t.time}</span>
      <span class="pm-tl-event">${t.event}</span>
    </div>
  `).join('');

  document.getElementById('pm-rca').textContent = pm.rca;
  document.getElementById('pm-prevention').innerHTML = pm.prevention.map(p => `<li>${p}</li>`).join('');
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('export-md-btn').onclick = () => exportMarkdown(pm);
}

/* ─────────────────────────────────────────────
   SECTION 16: EXPORT MARKDOWN
───────────────────────────────────────────── */
function exportMarkdown(pm) {
  const lines = [
    `# Postmortem: ${pm.id}`,
    ``,
    `**Service:** ${pm.service}`,
    `**Date:** ${pm.date}`,
    `**Status:** ${pm.status.toUpperCase()}`,
    ``,
    `---`,
    ``,
    `## Timeline`,
    ``,
    ...pm.timeline.map(t => `- \`${t.time}\` — ${t.event}`),
    ``,
    `## Root Cause Analysis`,
    ``,
    pm.rca,
    ``,
    `## Prevention Actions`,
    ``,
    ...pm.prevention.map(p => `- ${p}`),
    ``,
    `---`,
    `*Generated by SRE-Bot*`,
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${pm.id}-postmortem.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─────────────────────────────────────────────
   SECTION 17: SETTINGS
───────────────────────────────────────────── */
function initSettings() {
  document.getElementById('save-settings-btn').addEventListener('click', () => {
    const toast = document.getElementById('settings-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  });
}

/* ─────────────────────────────────────────────
   SECTION 18A: AUTH
   Email OTP sign-in flow. Completely self-contained.
───────────────────────────────────────────── */
function initAuth() {
  const overlay    = document.getElementById('auth-overlay');
  const stepEmail  = document.getElementById('auth-step-email');
  const stepOtp    = document.getElementById('auth-step-otp');
  const emailInput = document.getElementById('auth-email');
  const sendBtn    = document.getElementById('auth-send-btn');
  const verifyBtn  = document.getElementById('auth-verify-btn');
  const backBtn    = document.getElementById('auth-back-btn');
  const errorEl    = document.getElementById('auth-error');
  const otpBoxes   = document.querySelectorAll('.otp-box');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
  function clearError() { errorEl.style.display = 'none'; }

  // OTP box keyboard wiring
  otpBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(-1);
      if (box.value) {
        box.classList.add('filled');
        if (i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
      } else {
        box.classList.remove('filled');
      }
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        otpBoxes[i - 1].focus();
        otpBoxes[i - 1].value = '';
        otpBoxes[i - 1].classList.remove('filled');
      }
    });
    box.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData)
        .getData('text').replace(/\D/g, '').slice(0, 6);
      pasted.split('').forEach((ch, idx) => {
        if (otpBoxes[idx]) {
          otpBoxes[idx].value = ch;
          otpBoxes[idx].classList.add('filled');
        }
      });
      if (otpBoxes[pasted.length - 1]) otpBoxes[pasted.length - 1].focus();
    });
  });

  // Step 1: Send OTP
  sendBtn.addEventListener('click', async () => {
    clearError();
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      showError('Please enter a valid email address.');
      return;
    }
    sendBtn.textContent = 'Sending...';
    sendBtn.disabled = true;

    const { error } = await sendOtp(email);

    sendBtn.textContent = 'Send 6-digit code';
    sendBtn.disabled = false;

    if (error) {
      showError('Could not send code: ' + error.message);
      return;
    }

    document.getElementById('auth-email-display').textContent = email;
    stepEmail.style.display = 'none';
    stepOtp.style.display   = 'block';
    otpBoxes[0].focus();
  });

  emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn.click();
  });

  // Step 2: Verify OTP
  verifyBtn.addEventListener('click', async () => {
    clearError();
    const email = emailInput.value.trim();
    const token = Array.from(otpBoxes).map(b => b.value).join('');

    if (token.length < 6) {
      showError('Please enter all 6 digits.');
      return;
    }

    verifyBtn.textContent = 'Verifying...';
    verifyBtn.disabled = true;

    const { user, error } = await verifyOtp(email, token);

    verifyBtn.textContent = 'Verify & Sign In';
    verifyBtn.disabled = false;

    if (error) {
      showError('Invalid or expired code. Please try again.');
      otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
      otpBoxes[0].focus();
      return;
    }

    onSignedIn(user);
  });

  // Back button
  backBtn.addEventListener('click', () => {
    clearError();
    stepOtp.style.display   = 'none';
    stepEmail.style.display = 'block';
    otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
    emailInput.focus();
  });
}

/* ─────────────────────────────────────────────
   onSignedIn — called after successful auth
───────────────────────────────────────────── */
async function onSignedIn(user) {
  state.currentUser = user;

  const overlay = document.getElementById('auth-overlay');
  overlay.classList.add('hidden');
  setTimeout(() => overlay.style.display = 'none', 300);

  const sidebarUser = document.getElementById('sidebar-user');
  sidebarUser.style.display = 'flex';
  document.getElementById('sidebar-user-email').textContent = user.email;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
    location.reload();
  });

  addLogEntry(`Signed in as ${user.email}`, 'ok');
  await loadProjects();
}

/* ─────────────────────────────────────────────
   SECTION 18B: PROJECTS
───────────────────────────────────────────── */
function initProjects() {
  const addBtn     = document.getElementById('add-project-btn');
  const modal      = document.getElementById('project-modal');
  const closeBtn   = document.getElementById('project-modal-close');
  const cancelBtn  = document.getElementById('project-modal-cancel');
  const saveBtn    = document.getElementById('project-save-btn');
  const repoInput  = document.getElementById('proj-repo');
  const demoInput  = document.getElementById('proj-demo');
  const modalError = document.getElementById('project-modal-error');

  // Auto-fill demo URL when repo URL is entered
  repoInput.addEventListener('blur', () => {
    const val = repoInput.value.trim();
    if (!val.startsWith('https://github.com/')) return;
    const p = val.replace('https://github.com/', '').split('/');
    if (p[0] && p[1] && !demoInput.value) {
      demoInput.value = `https://${p[0]}.github.io/${p[1]}`;
    }
  });

  function openModal() { modal.style.display = 'flex'; repoInput.focus(); }
  function closeModal() {
    modal.style.display = 'none';
    repoInput.value = '';
    demoInput.value = '';
    modalError.style.display = 'none';
    // Clean up any injected confirm buttons
    modal.querySelectorAll('.confirm-anyway-btn, .github-otp-wrap').forEach(el => el.remove());
  }

  addBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // Save button — full validation flow
  saveBtn.addEventListener('click', async () => {
    modalError.style.display = 'none';
    const repoUrl = repoInput.value.trim();
    const demoUrl = demoInput.value.trim();

    // Basic validation
    if (!repoUrl || !repoUrl.startsWith('https://github.com/')) {
      modalError.textContent = 'Please enter a valid GitHub repository URL (https://github.com/...).';
      modalError.style.display = 'block';
      return;
    }
    if (!demoUrl) {
      modalError.textContent = 'Please enter the live demo URL.';
      modalError.style.display = 'block';
      return;
    }
    if (!state.currentUser) {
      modalError.textContent = 'You must be signed in to add a project.';
      modalError.style.display = 'block';
      return;
    }

    const parts = repoUrl.replace('https://github.com/', '').split('/');
    const owner = parts[0];
    const repo  = parts[1];
    const name  = parts.slice(0, 2).join('/');

    // Validate demo URL belongs to same GitHub owner
    if (!demoUrl.includes(owner)) {
      modalError.textContent = `Demo URL must belong to the same GitHub owner "${owner}". Expected something like: https://${owner}.github.io/${repo}`;
      modalError.style.display = 'block';
      return;  // hard stop
    }

    saveBtn.textContent = 'Checking GitHub...';
    saveBtn.disabled = true;

    // GitHub ownership verification via commits API
    const check = await verifyGithubOwnership(repoUrl, state.currentUser.email);

    saveBtn.textContent = 'Save Project';
    saveBtn.disabled = false;
  });
}

    if (!check.verified) {
      if (check.githubEmail) {
        // Email mismatch — send OTP to GitHub email and wait for verification
        modalError.innerHTML =
          `Your sign-in email (<strong>${state.currentUser.email}</strong>) doesn't match ` +
          `the GitHub repo's commit email (<strong>${check.githubEmail}</strong>).<br><br>` +
          `A verification code has been sent to <strong>${check.githubEmail}</strong>. ` +
          `Enter it below to confirm ownership.`;
        modalError.style.display = 'block';
        await sendOtp(check.githubEmail);
        showGithubOtpPrompt(modal, check.githubEmail, { name, repoUrl, demoUrl }, closeModal);
        return;  // hard stop — waits for OTP
      }

      if (check.error) {
        // GitHub API failed — block save
        modalError.textContent = `Could not verify GitHub ownership: ${check.error}. Please check the repo URL and try again.`;
        modalError.style.display = 'block';
        return;  // hard stop
      }

      // GitHub email is private (noreply) — require explicit confirmation click
      modalError.innerHTML =
        `The GitHub account <strong>${check.login}</strong> uses a private email so we ` +
        `can't verify ownership automatically.<br><br>` +
        `Only proceed if this is your repository.`;
      modalError.style.display = 'block';

      const existing = modal.querySelector('.confirm-anyway-btn');
      if (!existing) {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-secondary confirm-anyway-btn';
        confirmBtn.style.cssText = 'width:100%; margin-top:10px';
        confirmBtn.textContent = 'Yes, this is my repo — Save anyway';
        confirmBtn.addEventListener('click', async () => {
          confirmBtn.remove();
          await doSaveProject({ name, repoUrl, demoUrl }, closeModal);
        });
        modal.querySelector('.modal-card').appendChild(confirmBtn);
      }
      return;  // hard stop — waits for confirm click
    }

    // Verified — save
    await doSaveProject({ name, repoUrl, demoUrl }, closeModal);
  });
}

/* ─────────────────────────────────────────────
   doSaveProject
───────────────────────────────────────────── */
async function doSaveProject({ name, repoUrl, demoUrl }, closeModal) {
  const saved = await saveProject({
    user_id:      state.currentUser.id,
    name,
    repo_url:     repoUrl,
    demo_url:     demoUrl,
    github_email: state.currentUser.email,
  });

  if (!saved) {
    const modalError = document.getElementById('project-modal-error');
    modalError.textContent = 'Failed to save project. Check console for details.';
    modalError.style.display = 'block';
    return;
  }

  state.projects.unshift(saved);
  renderProjects();
  renderServiceGrid();
  updateStatCards();
  closeModal();
  addLogEntry(`Project added: ${name}`, 'ok');
}

/* ─────────────────────────────────────────────
   showGithubOtpPrompt
───────────────────────────────────────────── */
function showGithubOtpPrompt(modal, githubEmail, projectData, closeModal) {
  const modalCard = modal.querySelector('.modal-card');
  const existing  = modal.querySelector('.github-otp-wrap');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.className = 'github-otp-wrap';
  wrap.innerHTML = `
    <div class="otp-inputs" id="gh-otp-inputs">
      <input class="otp-box" maxlength="1" type="text" inputmode="numeric" pattern="[0-9]" />
      <input class="otp-box" maxlength="1" type="text" inputmode="numeric" pattern="[0-9]" />
      <input class="otp-box" maxlength="1" type="text" inputmode="numeric" pattern="[0-9]" />
      <input class="otp-box" maxlength="1" type="text" inputmode="numeric" pattern="[0-9]" />
      <input class="otp-box" maxlength="1" type="text" inputmode="numeric" pattern="[0-9]" />
      <input class="otp-box" maxlength="1" type="text" inputmode="numeric" pattern="[0-9]" />
    </div>
    <button class="btn btn-primary" id="gh-otp-verify-btn" style="width:100%; margin-top:10px">
      Verify &amp; Save Project
    </button>
    <div class="modal-error" id="gh-otp-error" style="display:none; margin-top:8px"></div>
  `;
  modalCard.appendChild(wrap);

  const boxes = wrap.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].value = '';
      }
    });
    box.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData)
        .getData('text').replace(/\D/g, '').slice(0, 6);
      pasted.split('').forEach((ch, idx) => {
        if (boxes[idx]) boxes[idx].value = ch;
      });
    });
  });
  boxes[0].focus();

  document.getElementById('gh-otp-verify-btn').addEventListener('click', async () => {
    const token = Array.from(boxes).map(b => b.value).join('');
    const errEl = document.getElementById('gh-otp-error');
    errEl.style.display = 'none';

    if (token.length < 6) {
      errEl.textContent = 'Enter all 6 digits.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('gh-otp-verify-btn');
    btn.textContent = 'Verifying...';
    btn.disabled = true;

    const { error } = await verifyOtp(githubEmail, token);

    if (error) {
      errEl.textContent = 'Invalid or expired code. Try again.';
      errEl.style.display = 'block';
      btn.textContent = 'Verify & Save Project';
      btn.disabled = false;
      boxes.forEach(b => { b.value = ''; });
      boxes[0].focus();
      return;
    }

    wrap.remove();
    await doSaveProject(projectData, closeModal);
  });
}

/* ─────────────────────────────────────────────
   loadProjects / renderProjects
───────────────────────────────────────────── */
async function loadProjects() {
  if (!state.currentUser) return;
  const rows = await fetchProjects(state.currentUser.id);
  state.projects = rows;
  renderProjects();
  renderServiceGrid();
  updateStatCards();
  if (rows.length > 0) {
    addLogEntry(`Loaded ${rows.length} project(s) from Supabase.`, 'info');
  }
}

function renderProjects() {
  const grid  = document.getElementById('projects-grid');
  const empty = document.getElementById('projects-empty');

  if (state.projects.length === 0) {
    grid.style.display  = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.style.display  = 'grid';
  grid.innerHTML = '';

  state.projects.forEach(proj => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-card-header">
        <div class="project-name">${escapeHtml(proj.name)}</div>
        <button class="project-delete" data-id="${proj.id}" title="Remove project">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      <div class="project-link">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/></svg>
        <a href="${escapeHtml(proj.repo_url)}" target="_blank" rel="noopener">${escapeHtml(proj.repo_url)}</a>
      </div>
      <div class="project-link">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
        <a href="${escapeHtml(proj.demo_url)}" target="_blank" rel="noopener">${escapeHtml(proj.demo_url)}</a>
      </div>
      <div class="project-status-row">
        <div class="project-status-dot"></div>
        <span class="project-status-label">Monitoring active · Bob can analyze this repo</span>
      </div>
    `;

    card.querySelector('.project-delete').addEventListener('click', async () => {
      const ok = await deleteProject(proj.id);
      if (ok) {
        state.projects = state.projects.filter(p => p.id !== proj.id);
        renderProjects();
        renderServiceGrid();
        updateStatCards();
        addLogEntry(`Project removed: ${proj.name}`, 'warn');
      }
    });

    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────
   BOOT
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initClock();
  renderServiceGrid();
  initActivityLog();
  initSimulateButton();
  initIncidentActions();
  initGeneratePostmortem();
  renderPostmortemTable();
  initSettings();
  updateStatCards();
  initAuth();
  initProjects();
  initProjectOverlay();

  const session = await getSession();
  if (session && session.user) {
    await onSignedIn(session.user);
  }

  const dbPostmortems = await fetchPostmortems();
  if (dbPostmortems.length > 0) {
    const normalised = dbPostmortems.map(row => ({
      id:         row.incident_id,
      service:    row.service,
      date:       row.created_at ? row.created_at.split('T')[0] : '—',
      rootCause:  row.root_cause  ?? '—',
      status:     'resolved',
      timeline:   Array.isArray(row.timeline)           ? row.timeline           : [],
      rca:        row.root_cause  ?? '—',
      prevention: Array.isArray(row.prevention_actions) ? row.prevention_actions : [],
    }));
    state.postmortems = [...normalised, ...state.postmortems];
    renderPostmortemTable();
    addLogEntry(`Loaded ${dbPostmortems.length} postmortem(s) from Supabase.`, 'info');
  }

  const dbIncidents = await fetchIncidents();
  const activeInDB  = dbIncidents.find(i => i.status === 'active');
  if (activeInDB) {
    addLogEntry(`Found open incident ${activeInDB.id} in Supabase — showing on dashboard.`, 'warn');
    state.activeIncident = {
      id:                  activeInDB.id,
      service:             activeInDB.service,
      errorType:           activeInDB.error_type ?? 'Unknown',
      severity:            activeInDB.severity   ?? 'HIGH',
      startTime:           activeInDB.started_at
                             ? new Date(activeInDB.started_at).toLocaleString()
                             : '—',
      tl1: '—', tl2: '—', tl3: '—', tl4: null,
      resolved:            false,
      engineerTookControl: false,
    };
    const svc = services.find(s => s.id === activeInDB.service);
    if (svc) svc.status = 'critical';
    renderServiceGrid();
    updateStatCards();
    renderIncidentCard();
    document.getElementById('incident-badge').style.display = 'inline';
  }

  subscribeToIncidents((payload) => {
    const row = payload.new;

    if (payload.eventType === 'INSERT') {
      addLogEntry(`[Realtime] New incident detected: ${row.id} on ${row.service}`, 'alert');
      if (!state.activeIncident) {
        state.activeIncident = {
          id:                  row.id,
          service:             row.service,
          errorType:           row.error_type ?? 'Unknown',
          severity:            row.severity   ?? 'HIGH',
          startTime:           row.started_at
                                 ? new Date(row.started_at).toLocaleString()
                                 : new Date().toLocaleString(),
          tl1: '—', tl2: '—', tl3: '—', tl4: null,
          resolved:            false,
          engineerTookControl: false,
        };
        const proj = state.projects.find(p => p.name === row.service);
        if (proj) proj._status = 'critical';
        renderServiceGrid();
        updateStatCards();
        renderIncidentCard();
        document.getElementById('incident-badge').style.display = 'inline';
      }
    }

    if (payload.eventType === 'UPDATE' && row.status === 'resolved') {
      addLogEntry(`[Realtime] Incident ${row.id} marked resolved.`, 'ok');
      if (state.activeIncident && state.activeIncident.id === row.id) {
        const proj = state.projects.find(p => p.name === row.service);
        if (proj) proj._status = 'healthy';
        state.activeIncident = null;
        renderServiceGrid();
        updateStatCards();
        document.getElementById('incident-badge').style.display = 'none';
        document.getElementById('inc-status-text').textContent = 'Resolved';
        document.getElementById('tl-4').className = 'timeline-item resolved';
      }
    }
    
  });
});
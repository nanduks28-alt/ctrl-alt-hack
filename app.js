/* =============================================================
   UpTimeX — AI Incident Response Dashboard
   app.js — All application logic
   ============================================================= */

/* ─────────────────────────────────────────────
   SUPABASE IMPORTS
   All DB operations live in supabase.js.
   These are no-ops if Supabase isn't configured yet —
   the UI continues to work with local state only.
───────────────────────────────────────────── */
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
  syncProjectToMonitor,
} from './supabase.js'

/* ─────────────────────────────────────────────
   BACKEND CLIENT IMPORTS
   Integration with Python orchestrator service
───────────────────────────────────────────── */
import {
  checkOrchestratorHealth,
  triggerRealWorkflow,
  subscribeToWorkflowUpdates,
  unsubscribeFromWorkflow,
  getWorkflowStageInfo,
  logWorkflowEvent,
  WORKFLOW_STAGES,
} from './backend_client.js'

/* ─────────────────────────────────────────────
   SECTION 1: STATE
   Central state object for the whole app.
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
  workflowChannel: null,   // realtime channel for current incident workflow
  orchestratorOnline: false,
};

/* ─────────────────────────────────────────────
   SECTION 2: SERVICE DATA
   The 6 monitored services with their initial state.
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
   Pre-seeded data so the table isn't empty.
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
   Tab-based page switching via sidebar links.
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
  // Deactivate all nav items and pages
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Activate the target
  const navItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  const page    = document.getElementById(`page-${pageId}`);

  if (navItem) navItem.classList.add('active');
  if (page)    page.classList.add('active');
}

/* ─────────────────────────────────────────────
   SECTION 5: LIVE CLOCK
   Updates the topbar clock every second.
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
   Renders service health cards on the dashboard.
   Uses user's registered projects when available,
   falls back to hardcoded services when none added yet.
───────────────────────────────────────────── */
function renderServiceGrid() {
  const grid = document.getElementById('service-grid');
  const meta = document.getElementById('health-meta');
  grid.innerHTML = '';

  // If the user has added projects, show those instead of fake services
  const hasProjects = state.projects && state.projects.length > 0;

  if (!hasProjects) {
    // Empty state — prompt user to add a project
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
    // Each project gets a runtime status entry if not already tracked
    if (!proj._status)      proj._status       = 'healthy';
    if (!proj._uptime)      proj._uptime       = (99 + Math.random()).toFixed(2) + '%';
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
   Appends timestamped entries to the activity feed.
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

  // Auto-scroll to bottom
  log.scrollTop = log.scrollHeight;
}

function initActivityLog() {
  addLogEntry('System initialized. All services nominal.', 'ok');
  addLogEntry('Bob AI engine connected. Credits: 2/40.', 'info');
}

/* ─────────────────────────────────────────────
   SECTION 8: SIMULATE INCIDENT
   Core flow: pick a service, trigger incident state,
   update UI across all pages.
───────────────────────────────────────────── */
function initSimulateButton() {
  document.getElementById('simulate-btn').addEventListener('click', simulateIncident);
}

async function simulateIncident() {
  if (state.activeIncident) {
    // Don't allow a second incident while one is active
    addLogEntry('Cannot simulate: an incident is already active.', 'warn');
    return;
  }

  // Must have at least one project registered to simulate
  if (!state.projects || state.projects.length === 0) {
    addLogEntry('Add a project first before simulating an incident.', 'warn');
    navigateTo('projects');
    return;
  }

  // Check orchestrator health
  addLogEntry('Checking orchestrator status...', 'info');
  const health = await checkOrchestratorHealth();
  
  const useRealWorkflow = health.online;
  
  if (useRealWorkflow) {
    logWorkflowEvent('Orchestrator is online - using real workflow', 'success');
    addLogEntry('🤖 Orchestrator online. Using real AI workflow.', 'ok');
  } else {
    logWorkflowEvent(`Orchestrator offline (${health.reason}) - using simulation mode`, 'warn');
    addLogEntry(`⚠️  Orchestrator offline. Using simulation mode.`, 'warn');
  }

  // Pick a random project as the affected service
  const proj = state.projects[Math.floor(Math.random() * state.projects.length)];
  const svcName = proj.name; // e.g. "owner/repo"

  // Build incident object
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts  = () => {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const incidentId = `INC-${String(state.incidentCounter).padStart(4, '0')}`;
  state.incidentCounter++;

  // Generate fake logs for the incident
  const fakeLogs = [
    `[ERROR] ${svcName}: FATAL connection pool exhausted (max=100)`,
    `[ERROR] ${svcName}: Timeout waiting for connection after 30000ms`,
    `[WARN]  ${svcName}: Queue depth: 847 pending requests`,
    `[ERROR] ${svcName}: DB connection refused — too many clients`,
    `[INFO]  ${svcName}: Attempting graceful restart...`,
    `[ERROR] ${svcName}: Restart failed — process exited with code 1`,
    `[WARN]  ${svcName}: Health check failing for 3 consecutive intervals`,
  ].join('\n');

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
    useRealWorkflow: useRealWorkflow,
    workflowSubscription: null
  };

  // 1. Mark the project as critical
  proj._status = 'critical';
  renderServiceGrid();

  // 2. Update stat cards
  updateStatCards();

  // 3. Activity log
  addLogEntry(`ALERT: ${svcName} is down — connection pool exhausted`, 'alert');

  if (useRealWorkflow) {
    // ═══════════════════════════════════════════════════════════
    // REAL WORKFLOW MODE - Orchestrator processes the incident
    // ═══════════════════════════════════════════════════════════
    
    logWorkflowEvent(`Creating incident ${incidentId} for orchestrator`);
    
    // Create incident with status='pending_analysis' to trigger orchestrator
    const result = await triggerRealWorkflow({
      id: incidentId,
      service: svcName,
      error_type: 'timeout',
      severity: 'CRITICAL',
      started_at: now.toISOString(),
      logs: fakeLogs,
      commits: null
    });

    if (result.success) {
      logWorkflowEvent('Incident created successfully', 'success');
      addLogEntry(`Incident ${incidentId} created. Orchestrator processing...`, 'info');
      
      // Subscribe to workflow updates
      const subscription = subscribeToWorkflowUpdates(incidentId, (update) => {
        handleWorkflowUpdate(incidentId, update);
      });
      
      state.activeIncident.workflowSubscription = subscription;
      
      // Show incident badge and navigate
      document.getElementById('incident-badge').style.display = 'inline';
      navigateTo('incidents');
      renderIncidentCard();
      fillBobContext();
      
    } else {
      logWorkflowEvent(`Failed to create incident: ${result.error}`, 'error');
      addLogEntry(`Failed to create incident: ${result.error}`, 'alert');
      // Fall back to simulation mode
      simulateIncidentFallback(proj, svcName, incidentId, now, ts);
    }
    
  } else {
    // ═══════════════════════════════════════════════════════════
    // SIMULATION MODE - Frontend simulates the workflow
    // ═══════════════════════════════════════════════════════════
    
    simulateIncidentFallback(proj, svcName, incidentId, now, ts);
  }
}

// Fallback simulation mode (original behavior)
function simulateIncidentFallback(proj, svcName, incidentId, now, ts) {
  // Save incident with 'active' status (not pending_analysis)
  saveIncident({
    id: incidentId,
    service: svcName,
    error_type: 'Connection timeout / Pool exhausted',
    severity: 'CRITICAL',
    status: 'active',
    started_at: now.toISOString(),
    logs: null,
    commits: null,
  });

  // Staggered log entries (original simulation)
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

// Handle real-time workflow updates from orchestrator
function handleWorkflowUpdate(incidentId, update) {
  if (!state.activeIncident || state.activeIncident.id !== incidentId) {
    return;
  }

  const stageInfo = getWorkflowStageInfo(update.stage);
  
  logWorkflowEvent(`Stage: ${stageInfo.label} - ${stageInfo.description}`);
  addLogEntry(`${stageInfo.icon} ${stageInfo.label}: ${stageInfo.description}`, 'info');

  // Update incident card if visible
  if (update.stage === 'completed') {
    if (update.status === 'resolved') {
      addLogEntry(`✅ Incident resolved automatically!`, 'ok');
      addLogEntry(`Recovery action: ${update.recoveryAction}`, 'ok');
      
      // Mark incident as resolved
      state.activeIncident.resolved = true;
      state.activeIncident.tl4 = new Date().toLocaleTimeString();
      
      // Update UI
      const proj = state.projects.find(p => p.name === state.activeIncident.service);
      if (proj) proj._status = 'healthy';
      renderServiceGrid();
      updateStatCards();
      document.getElementById('incident-badge').style.display = 'none';
      
    } else if (update.status === 'analyzed') {
      addLogEntry(`🤖 Bob AI analysis complete!`, 'ok');
      addLogEntry(`Root cause: ${update.rootCause}`, 'info');
      addLogEntry(`Confidence: ${update.confidence}%`, 'info');
      
      // Update Bob Investigation page with real results
      document.getElementById('bob-root-cause').textContent = update.rootCause;
      document.getElementById('bob-fix').textContent = update.suggestedFix;
      document.getElementById('bob-confidence-fill').style.width = `${update.confidence}%`;
      document.getElementById('bob-confidence-pct').textContent = `${update.confidence}%`;
      
      // Show Bob result
      document.getElementById('bob-loading').style.display = 'none';
      document.getElementById('bob-result').style.display = 'block';
      
      state.bobAnalysisDone = true;
    }
    
    // Unsubscribe from updates
    if (state.activeIncident.workflowSubscription) {
      unsubscribeFromWorkflow(state.activeIncident.workflowSubscription);
      state.activeIncident.workflowSubscription = null;
    }
  }
}

/* ─────────────────────────────────────────────
   SECTION 9: STAT CARDS UPDATE
   Reflects current state in the 4 top cards.
───────────────────────────────────────────── */
function updateStatCards() {
  const inc = state.activeIncident;
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

  // Credits
  const pct = Math.round((state.bobCredits / state.bobCreditsMax) * 100);
  document.getElementById('stat-credits').textContent = `${state.bobCredits} / ${state.bobCreditsMax}`;
  document.getElementById('credits-text').textContent = `${state.bobCredits} / ${state.bobCreditsMax}`;
  document.getElementById('credits-fill').style.width = `${pct}%`;
}

/* ─────────────────────────────────────────────
   SECTION 10: INCIDENT CARD RENDER
   Populates and shows the incident card on page 2.
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

  // Timeline steps
  document.getElementById('tl-1-time').textContent = inc.tl1 || '—';
  document.getElementById('tl-2-time').textContent = inc.tl2 || '—';
  document.getElementById('tl-3-time').textContent = inc.tl3 || '—';
  document.getElementById('tl-4-time').textContent = '—';

  // Reset timeline classes
  ['tl-1','tl-2','tl-3','tl-4'].forEach(id => {
    const el = document.getElementById(id);
    el.className = 'timeline-item';
  });

  document.getElementById('tl-1').classList.add('completed');
  document.getElementById('tl-2').classList.add('completed');
  document.getElementById('tl-3').classList.add('active');
}

/* ─────────────────────────────────────────────
   SECTION 11: BOB CONTEXT FILL
   Populates the left panel of the Bob Investigation page.
───────────────────────────────────────────── */
function fillBobContext() {
  const inc = state.activeIncident;
  if (!inc) return;

  document.getElementById('bob-service').textContent = inc.service;
  document.getElementById('bob-error').textContent   = inc.errorType;

  // Fake logs
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

  // Fake commits
  const commits = [
    { hash: 'a3f9c12', msg: 'feat: increase DB pool size to 100 for scale', author: 'dev-team', time: '2h ago' },
    { hash: 'b7e2d45', msg: 'fix: update connection timeout from 10s to 30s', author: 'ops-team', time: '5h ago' },
    { hash: 'c1a8f67', msg: 'chore: bump pg driver to v8.11.3', author: 'dependabot', time: '1d ago' },
  ];

  const commitsList = document.getElementById('bob-commits');
  commitsList.innerHTML = commits.map(c => `
    <div class="commit-item">
      <div class="commit-hash">${c.hash}</div>
      <div class="commit-msg">${c.msg}</div>
      <div class="commit-meta">${c.author} · ${c.time}</div>
    </div>
  `).join('');

  // Actions tried
  document.getElementById('bob-actions').innerHTML = `
    <div class="action-item">✗ Restart attempted: Failed (exit code 1)</div>
    <div class="action-item">✗ Rollback attempted: Failed (no prior healthy snapshot)</div>
  `;
}

/* ─────────────────────────────────────────────
   SECTION 12: BOB ANALYSIS
   Shows loading spinner then animates in the result.
───────────────────────────────────────────── */
function triggerBobAnalysis() {
  state.bobAnalysisDone = false;

  // Show loading, hide empty/result
  document.getElementById('bob-empty').style.display   = 'none';
  document.getElementById('bob-result').style.display  = 'none';
  document.getElementById('bob-loading').style.display = 'flex';

  // Consume a credit
  state.bobCredits++;
  updateStatCards();

  // After 2 seconds, show the result
  setTimeout(() => {
    document.getElementById('bob-loading').style.display = 'none';

    const result = document.getElementById('bob-result');
    result.style.display = 'block';

    document.getElementById('bob-root-cause').textContent =
      'Database connection pool exhausted. Max connections (100) reached due to recent pool size increase combined with a traffic spike. Connections are not being released properly.';

    document.getElementById('bob-fix').textContent =
      'Reduce pool size from 100 to 50 and restart the connection manager. Audit connection release logic in the query handler — suspected missing .release() call in error path.';

    document.getElementById('bob-risk').textContent  = 'LOW';
    document.getElementById('bob-risk').className    = 'risk-badge low';

    // Animate confidence bar to 91%
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
   "Take Control" and "View Bob Analysis" buttons.
───────────────────────────────────────────── */
function initIncidentActions() {
  document.getElementById('take-control-btn').addEventListener('click', () => {
    if (!state.activeIncident) return;
    state.activeIncident.engineerTookControl = true;
    addLogEntry('Engineer took manual control of the incident.', 'warn');
    document.getElementById('inc-status-text').textContent = 'Engineer in control';

    // ── Supabase: record that an engineer took over ──────────
    updateIncident(state.activeIncident.id, { status: 'engineer_control' });
  });

  document.getElementById('view-bob-btn').addEventListener('click', () => {
    navigateTo('bob');
  });
}

/* ─────────────────────────────────────────────
   SECTION 14: GENERATE POSTMORTEM
   Creates a postmortem record and resolves the incident.
───────────────────────────────────────────── */
function initGeneratePostmortem() {
  document.getElementById('gen-postmortem-btn').addEventListener('click', () => {
    if (!state.activeIncident) return;

    const inc = state.activeIncident;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts  = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Mark resolved
    inc.resolved = true;
    inc.tl4 = ts;
    state.activeIncident = null;

    // ── Supabase: mark incident resolved ────────────────────
    updateIncident(inc.id, {
      status:      'resolved',
      resolved_at: now.toISOString(),
      root_cause:  'Database connection pool exhausted. Max connections reached.',
      suggested_fix: 'Reduce pool size from 100 to 50 and restart the connection manager.',
      confidence:  91,
    });

    // Restore project to healthy
    const proj = state.projects.find(p => p.name === inc.service);
    if (proj) proj._status = 'healthy';

    // Update UI
    renderServiceGrid();
    updateStatCards();

    // Hide incident badge
    document.getElementById('incident-badge').style.display = 'none';

    // Update incident card timeline
    document.getElementById('tl-4').className = 'timeline-item resolved';
    document.getElementById('tl-4-time').textContent = ts;
    document.getElementById('tl-3').className = 'timeline-item completed';
    document.getElementById('inc-status-text').textContent = 'Resolved';

    // Add postmortem record
    const pm = {
      id: inc.id,
      service: inc.service,
      date: now.toISOString().split('T')[0],
      rootCause: 'Database connection pool exhausted. Max connections reached.',
      status: 'resolved',
      timeline: [
        { time: inc.tl1,  event: `Alert triggered — ${inc.service} connection pool exhausted` },
        { time: inc.tl2,  event: 'Auto-restart attempted — failed (exit code 1)' },
        { time: inc.tl3,  event: 'Escalated to Bob AI for root cause analysis' },
        { time: ts,       event: 'Fix applied. Service restored. Incident resolved.' },
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

    // ── Supabase: persist the postmortem ────────────────────
    savePostmortem({
      incident_id:        pm.id,
      service:            pm.service,
      root_cause:         pm.rootCause,
      timeline:           pm.timeline,
      prevention_actions: pm.prevention,
      created_at:         now.toISOString(),
    });

    addLogEntry(`Postmortem generated for ${inc.id}. Incident resolved.`, 'ok');

    // Refresh dashboard charts with updated incident data
    refreshCharts();

    // Navigate to postmortem page
    navigateTo('postmortem');
  });
}

/* ─────────────────────────────────────────────
   SECTION 15: POSTMORTEM TABLE
   Renders the table and handles row expansion.
───────────────────────────────────────────── */
function renderPostmortemTable() {
  const tbody = document.getElementById('postmortem-tbody');
  tbody.innerHTML = '';

  // Combine new + historical
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
  // Deselect all rows
  document.querySelectorAll('#postmortem-tbody tr').forEach(r => r.classList.remove('selected'));
  row.classList.add('selected');

  const detail = document.getElementById('postmortem-detail');
  detail.style.display = 'block';

  document.getElementById('pm-detail-title').textContent = `Postmortem: ${pm.id}`;

  // Timeline
  const tlEl = document.getElementById('pm-timeline');
  tlEl.innerHTML = pm.timeline.map(t => `
    <div class="pm-timeline-entry">
      <span class="pm-tl-time">${t.time}</span>
      <span class="pm-tl-event">${t.event}</span>
    </div>
  `).join('');

  // RCA
  document.getElementById('pm-rca').textContent = pm.rca;

  // Prevention
  const prevEl = document.getElementById('pm-prevention');
  prevEl.innerHTML = pm.prevention.map(p => `<li>${p}</li>`).join('');

  // Scroll to detail
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Wire export button
  document.getElementById('export-md-btn').onclick = () => exportMarkdown(pm);
}

/* ─────────────────────────────────────────────
   SECTION 16: EXPORT AS MARKDOWN
   Generates a .md file and triggers a download.
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
    `*Generated by UpTimeX*`,
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
   Profile display, Bob AI prefs, notifications,
   connection status checks, danger zone actions.
───────────────────────────────────────────── */
function initSettings() {

  // ── Slider: Bob confidence threshold ────────────────────
  const slider   = document.getElementById('bob-confidence');
  const sliderVal= document.getElementById('bob-confidence-val');
  slider.addEventListener('input', () => {
    sliderVal.textContent = slider.value + '%';
  });

  // ── Save button ──────────────────────────────────────────
  document.getElementById('save-settings-btn').addEventListener('click', () => {
    // Persist preferences to localStorage
    localStorage.setItem('sre_bob_threshold',   slider.value);
    localStorage.setItem('sre_auto_bob',        document.getElementById('toggle-auto-bob').checked);
    localStorage.setItem('sre_webhook_url',     document.getElementById('webhook-url').value.trim());
    localStorage.setItem('sre_notif_critical',  document.getElementById('notif-critical').checked);
    localStorage.setItem('sre_notif_resolved',  document.getElementById('notif-resolved').checked);
    localStorage.setItem('sre_notif_bob',       document.getElementById('notif-bob').checked);

    const toast = document.getElementById('settings-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  });

  // ── Load saved preferences ───────────────────────────────
  const savedThreshold = localStorage.getItem('sre_bob_threshold');
  if (savedThreshold) {
    slider.value = savedThreshold;
    sliderVal.textContent = savedThreshold + '%';
  }
  const savedWebhook = localStorage.getItem('sre_webhook_url');
  if (savedWebhook) document.getElementById('webhook-url').value = savedWebhook;

  if (localStorage.getItem('sre_auto_bob') === 'false')
    document.getElementById('toggle-auto-bob').checked = false;
  if (localStorage.getItem('sre_notif_critical') === 'false')
    document.getElementById('notif-critical').checked = false;
  if (localStorage.getItem('sre_notif_resolved') === 'false')
    document.getElementById('notif-resolved').checked = false;
  if (localStorage.getItem('sre_notif_bob') === 'true')
    document.getElementById('notif-bob').checked = true;

  // ── Danger zone: sign out ────────────────────────────────
  document.getElementById('settings-signout-btn').addEventListener('click', async () => {
    await signOut();
    location.reload();
  });

  // ── Danger zone: clear local data ───────────────────────
  document.getElementById('settings-clear-btn').addEventListener('click', () => {
    if (!confirm('Reset local incident counter and state? This does not delete Supabase data.')) return;
    state.activeIncident  = null;
    state.incidentCounter = 1;
    state.postmortems     = [];
    state.bobAnalysisDone = false;
    renderServiceGrid();
    renderPostmortemTable();
    updateStatCards();
    document.getElementById('incident-badge').style.display = 'none';
    document.getElementById('incident-card').style.display  = 'none';
    document.getElementById('incidents-empty').style.display= 'flex';
    addLogEntry('Local data cleared.', 'warn');
    const toast = document.getElementById('settings-toast');
    toast.textContent = 'Local data cleared.';
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); toast.textContent = 'Settings saved.'; }, 2500);
  });
}

/* populateSettingsProfile(user)
   Called after sign-in to fill in the profile card
   and run connection checks. */
function populateSettingsProfile(user) {
  if (!user) return;

  // Avatar initials
  const initials = user.email.slice(0, 2).toUpperCase();
  document.getElementById('settings-avatar').textContent        = initials;
  document.getElementById('settings-profile-email').textContent = user.email;
  document.getElementById('settings-profile-meta').textContent  =
    'GitHub email on file: ' + (user.email || '—');

  // Supabase project URL (read-only reference)
  const urlEl = document.getElementById('settings-project-url');
  if (urlEl) urlEl.textContent = 'Supabase project: ' + (window.__SUPABASE_URL__ || 'configured in supabase.js');

  // Run connection checks
  checkConnections();
}

async function checkConnections() {
  // ── Supabase ─────────────────────────────────────────────
  setConn('supabase', 'checking', 'Checking...');
  try {
    const { error } = await supabase.from('projects').select('id').limit(1);
    if (error) throw error;
    setConn('supabase', 'ok', 'Connected');
  } catch {
    setConn('supabase', 'error', 'Error');
  }

  // ── GitHub API ───────────────────────────────────────────
  setConn('github', 'checking', 'Checking...');
  try {
    const res = await fetch('https://api.github.com/rate_limit');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const remaining = data.rate?.remaining ?? '?';
    setConn('github', 'ok', `${remaining} req/hr remaining`);
  } catch {
    setConn('github', 'error', 'Unreachable');
  }

  // ── Realtime / Orchestrator ───────────────────────────────
  setConn('realtime', 'checking', 'Checking...');
  try {
    const health = await checkOrchestratorHealth();
    state.orchestratorOnline = health.online;
    if (health.online) {
      setConn('realtime', 'ok', `Orchestrator online · ${health.message}`);
    } else {
      setConn('realtime', 'error', `Orchestrator offline · ${health.message}`);
    }
  } catch {
    setConn('realtime', 'error', 'Could not check');
  }
}

function setConn(name, state, label) {
  const dot    = document.getElementById(`conn-${name}-dot`);
  const status = document.getElementById(`conn-${name}-status`);
  if (dot)    dot.className    = `settings-conn-dot ${state}`;
  if (status) status.textContent = label;
}

/* ─────────────────────────────────────────────
   SECTION 18A: AUTH
   Email OTP sign-in flow using Supabase Auth.
   Shows a fullscreen overlay until the user is verified.
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

  // ── OTP box keyboard wiring ──────────────────────────────
  // Auto-advance to next box, backspace goes back.
  otpBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(-1); // digits only
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
    // Handle paste of full 6-digit code
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

  // ── Step 1: Send OTP ────────────────────────────────────
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

    // Move to OTP step
    document.getElementById('auth-email-display').textContent = email;
    stepEmail.style.display = 'none';
    stepOtp.style.display   = 'block';
    otpBoxes[0].focus();
  });

  // Allow pressing Enter on email field
  emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn.click();
  });

  // ── Step 2: Verify OTP ──────────────────────────────────
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
      // Clear boxes
      otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
      otpBoxes[0].focus();
      return;
    }

    // Success — dismiss overlay and boot the app
    onSignedIn(user);
  });

  // ── Back button ─────────────────────────────────────────
  backBtn.addEventListener('click', () => {
    clearError();
    stepOtp.style.display   = 'none';
    stepEmail.style.display = 'block';
    otpBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
    emailInput.focus();
  });
}

/* ─────────────────────────────────────────────
   onSignedIn(user)
   Called after successful auth. Hides the overlay,
   shows the user email in the sidebar, loads projects.
───────────────────────────────────────────── */
async function onSignedIn(user) {
  state.currentUser = user;

  // Hide auth overlay with fade
  const overlay = document.getElementById('auth-overlay');
  overlay.classList.add('hidden');
  setTimeout(() => overlay.style.display = 'none', 300);

  // Show user email in sidebar
  const sidebarUser = document.getElementById('sidebar-user');
  sidebarUser.style.display = 'flex';
  document.getElementById('sidebar-user-email').textContent = user.email;

  // Sign-out button
  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
    location.reload();
  });

  addLogEntry(`Signed in as ${user.email}`, 'ok');

  // Populate settings profile card
  populateSettingsProfile(user);

  // Load this user's projects
  await loadProjects();

  // Fetch all incidents for this account and push to dashboard charts
  await refreshCharts();
}

/* ─────────────────────────────────────────────
   SECTION 18B: PROJECTS
   Add / list / delete user projects.
   Each project has a GitHub repo URL + live demo URL.
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

  function openModal()  { modal.style.display = 'flex'; repoInput.focus(); }
  function closeModal() {
    modal.style.display = 'none';
    repoInput.value = '';
    demoInput.value = '';
    modalError.style.display = 'none';
    modal.querySelectorAll('.confirm-anyway-btn, .github-otp-wrap').forEach(el => el.remove());
  }

  addBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  saveBtn.addEventListener('click', async () => {
    modalError.style.display = 'none';
    const repoUrl = repoInput.value.trim();
    const demoUrl = demoInput.value.trim();

    if (!repoUrl || !repoUrl.startsWith('https://github.com/')) {
      modalError.textContent = 'Please enter a valid GitHub repository URL (https://github.com/...).';
      modalError.style.display = 'block'; return;
    }
    if (!demoUrl) {
      modalError.textContent = 'Please enter the live demo URL.';
      modalError.style.display = 'block'; return;
    }
    if (!state.currentUser) {
      modalError.textContent = 'You must be signed in to add a project.';
      modalError.style.display = 'block'; return;
    }

    const parts = repoUrl.replace('https://github.com/', '').split('/');
    const owner = parts[0];
    const repo  = parts[1];
    const name  = parts.slice(0, 2).join('/');

    if (!owner || !repo) {
      modalError.textContent = 'Invalid GitHub URL — must be https://github.com/owner/repo';
      modalError.style.display = 'block'; return;
    }

    saveBtn.textContent = 'Checking GitHub...';
    saveBtn.disabled = true;
    const check = await verifyGithubOwnership(repoUrl, state.currentUser.email);
    saveBtn.textContent = 'Save Project';
    saveBtn.disabled = false;

    // Emails match — save directly
    if (check.verified) {
      await doSaveProject({ name, repoUrl, demoUrl }, closeModal);
      return;
    }

    // Emails don't match but we found a real GitHub email — warn but allow
    if (check.githubEmail) {
      modalError.innerHTML =
        `⚠️ Your sign-in email (<strong>${state.currentUser.email}</strong>) doesn't match ` +
        `the GitHub commit email (<strong>${check.githubEmail}</strong>). ` +
        `Make sure this is your repo.`;
      modalError.style.display = 'block';
      await doSaveProject({ name, repoUrl, demoUrl }, closeModal);
      return;
    }

    // GitHub API error or private email — just save, warn in log
    addLogEntry(`GitHub ownership could not be verified for ${name} — saved anyway.`, 'warn');
    await doSaveProject({ name, repoUrl, demoUrl }, closeModal);
  });
}
/* ─────────────────────────────────────────────
   doSaveProject({ name, repoUrl, demoUrl }, closeModal)
   Final step — actually inserts the project row.
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

  // Sync to monitored_projects so the Python monitor agent tracks it
  syncProjectToMonitor(saved.id, saved.name, saved.repo_url, saved.demo_url)
    .then(r => {
      if (r) addLogEntry(`Monitor agent now watching ${name}`, 'info');
    });
}

/* ─────────────────────────────────────────────
   showGithubOtpPrompt(modal, githubEmail, projectData, closeModal)
   Injects a 6-box OTP prompt into the modal so the user
   can verify ownership of the GitHub email address.
───────────────────────────────────────────── */
function showGithubOtpPrompt(modal, githubEmail, projectData, closeModal) {
  const modalCard = modal.querySelector('.modal-card');

  // Inject OTP UI below the error message
  const existing = modal.querySelector('.github-otp-wrap');
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

  // Wire OTP boxes
  const boxes = wrap.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus(); boxes[i - 1].value = '';
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

  // Verify button
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

    // OTP verified — save the project
    wrap.remove();
    await doSaveProject(projectData, closeModal);
  });
}

async function loadProjects() {
  if (!state.currentUser) return;
  const rows = await fetchProjects(state.currentUser.id);
  state.projects = rows;
  renderProjects();
  renderServiceGrid();
  updateStatCards();
  if (rows.length > 0) {
    addLogEntry(`Loaded ${rows.length} project(s) from Supabase.`, 'info');
    // Backfill monitored_projects for any existing projects
    rows.forEach(p => syncProjectToMonitor(p.id, p.name, p.repo_url, p.demo_url));
  }
}

/* ─────────────────────────────────────────────
   refreshCharts()
   Fetches all incidents for the account and pushes
   real data to the dashboard charts via the global
   window.refreshDashboardCharts bridge.
───────────────────────────────────────────── */
async function refreshCharts() {
  if (typeof window.refreshDashboardCharts !== 'function') return;

  const incidents = await fetchIncidents();

  // Compute project health counts from current state
  const healthyCount  = state.projects.filter(p => !p._status || p._status === 'healthy').length;
  const criticalCount = state.projects.filter(p => p._status === 'critical').length;
  const degradedCount = state.projects.filter(p => p._status === 'degraded').length;

  window.refreshDashboardCharts(incidents, { healthyCount, criticalCount, degradedCount });

  addLogEntry(`Dashboard charts updated — ${incidents.length} incident(s) loaded.`, 'info');
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

    // Delete handler
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

// Simple HTML escape to prevent XSS from user-supplied URLs
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────
   SECTION 19: PROJECT BOARD PAGE
   Navigates to page-project-board and fills it
   with live GitHub + Supabase data.
───────────────────────────────────────────── */

const LANG_COLORS = {
  JavaScript:'#f7df1e', TypeScript:'#3178c6', Python:'#3572a5',
  HTML:'#e34c26', CSS:'#563d7c', Go:'#00add8', Rust:'#dea584',
  Java:'#b07219', 'C++':'#f34b7d', Ruby:'#701516',
  Shell:'#89e051', Vue:'#41b883', Svelte:'#ff3e00', default:'#4f8ef7',
};

function initProjectOverlay() {
  document.getElementById('board-back-btn').addEventListener('click', () => {
    navigateTo('dashboard');
  });
}

async function openProjectOverview(proj) {
  // Switch to the board page
  navigateTo('project-board');

  // ── Header ───────────────────────────────────────────────
  document.getElementById('board-title').textContent    = proj.name;
  document.getElementById('board-subtitle').textContent = proj.demo_url || 'Project Overview';
  document.getElementById('board-github-link').href     = proj.repo_url;
  document.getElementById('board-demo-link').href       = proj.demo_url || '#';
  if (!proj.demo_url) document.getElementById('board-demo-link').style.display = 'none';
  else                document.getElementById('board-demo-link').style.display = '';

  // ── Instant stats from local state ───────────────────────
  const status = proj._status || 'healthy';
  const statusEl = document.getElementById('bs-status');
  statusEl.textContent = status.toUpperCase();
  statusEl.className = `board-stat-val ${status === 'healthy' ? 'green' : status === 'critical' ? 'red' : 'yellow'}`;

  document.getElementById('bs-uptime').textContent = proj._uptime || '—';
  document.getElementById('bs-resp').textContent   = proj._responseTime || '—';
  document.getElementById('bs-users').textContent  = (Math.floor(Math.random() * 180) + 12).toLocaleString();

  // Reset loading states
  ['board-repo-info','board-languages','board-files','board-commits','board-incidents'].forEach(id => {
    document.getElementById(id).innerHTML =
      '<div class="board-loading"><div class="mini-spinner"></div>Loading...</div>';
  });
  document.getElementById('bs-issues').textContent   = '…';
  document.getElementById('bs-stars').textContent    = '…';
  document.getElementById('bs-incidents').textContent= '…';
  document.getElementById('bs-deploy').textContent   = '…';

  // Draw sparkline immediately
  drawBoardSparkline();

  // ── GitHub API (parallel) ─────────────────────────────────
  const [owner, repo] = proj.name.split('/');
  if (!owner || !repo) return;
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoRes, contentsRes, commitsRes, langsRes] = await Promise.allSettled([
    fetch(base),
    fetch(`${base}/contents`),
    fetch(`${base}/commits?per_page=10`),
    fetch(`${base}/languages`),
  ]);

  // Repo info
  if (repoRes.status === 'fulfilled' && repoRes.value.ok) {
    const r = await repoRes.value.json();
    document.getElementById('bs-issues').textContent = r.open_issues_count ?? '—';
    document.getElementById('bs-stars').textContent  = (r.stargazers_count ?? 0).toLocaleString();
    document.getElementById('bs-deploy').textContent = r.pushed_at ? r.pushed_at.split('T')[0] : '—';

    document.getElementById('board-repo-info').innerHTML = [
      { k: 'Stars',       v: (r.stargazers_count ?? 0).toLocaleString() + ' ⭐' },
      { k: 'Forks',       v: r.forks_count ?? 0 },
      { k: 'Watchers',    v: r.watchers_count ?? 0 },
      { k: 'Branch',      v: r.default_branch ?? 'main' },
      { k: 'Visibility',  v: r.private ? 'Private 🔒' : 'Public 🌐' },
      { k: 'Created',     v: r.created_at?.split('T')[0] ?? '—' },
      { k: 'Last push',   v: r.pushed_at?.split('T')[0]  ?? '—' },
      { k: 'License',     v: r.license?.spdx_id ?? 'None' },
      { k: 'Description', v: r.description ?? '—' },
    ].map(row => `
      <div class="board-info-row">
        <span class="board-info-key">${row.k}</span>
        <span class="board-info-val">${escapeHtml(String(row.v))}</span>
      </div>`).join('');
  } else {
    document.getElementById('board-repo-info').innerHTML =
      '<span style="font-size:11px;color:var(--text-muted)">Could not load (private or rate-limited).</span>';
  }

  // File tree
  if (contentsRes.status === 'fulfilled' && contentsRes.value.ok) {
    const items = await contentsRes.value.json();
    if (Array.isArray(items)) {
      items.sort((a,b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
      document.getElementById('board-files').innerHTML = items.map(item => {
        const isDir = item.type === 'dir';
        const icon  = isDir
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`
          : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        return `<div class="board-file-row ${isDir ? 'dir' : ''}">${icon}${escapeHtml(item.name)}</div>`;
      }).join('');
    }
  } else {
    document.getElementById('board-files').innerHTML =
      '<span style="font-size:11px;color:var(--text-muted)">Could not load files.</span>';
  }

  // Commits
  if (commitsRes.status === 'fulfilled' && commitsRes.value.ok) {
    const commits = await commitsRes.value.json();
    if (Array.isArray(commits) && commits.length) {
      document.getElementById('board-commits').innerHTML = commits.map(c => `
        <div class="board-commit-row">
          <div class="board-commit-hash">${c.sha?.slice(0,7) ?? '—'}</div>
          <div class="board-commit-msg">${escapeHtml(c.commit?.message?.split('\n')[0] ?? '—')}</div>
          <div class="board-commit-meta">${escapeHtml(c.commit?.author?.name ?? '—')} · ${c.commit?.author?.date?.split('T')[0] ?? '—'}</div>
        </div>`).join('');
    } else {
      document.getElementById('board-commits').innerHTML =
        '<span style="font-size:11px;color:var(--text-muted)">No commits found.</span>';
    }
  } else {
    document.getElementById('board-commits').innerHTML =
      '<span style="font-size:11px;color:var(--text-muted)">Could not load commits.</span>';
  }

  // Languages
  if (langsRes.status === 'fulfilled' && langsRes.value.ok) {
    const langs = await langsRes.value.json();
    const total = Object.values(langs).reduce((a,b) => a+b, 0);
    if (total > 0) {
      const sorted = Object.entries(langs).sort((a,b) => b[1]-a[1]).slice(0,8);
      document.getElementById('board-languages').innerHTML = sorted.map(([lang, bytes]) => {
        const pct   = ((bytes/total)*100).toFixed(1);
        const color = LANG_COLORS[lang] || LANG_COLORS.default;
        return `
          <div class="board-lang-row">
            <div class="board-lang-label"><span>${escapeHtml(lang)}</span><span>${pct}%</span></div>
            <div class="board-lang-bar"><div class="board-lang-fill" style="width:${pct}%;background:${color}"></div></div>
          </div>`;
      }).join('');
    }
  } else {
    document.getElementById('board-languages').innerHTML =
      '<span style="font-size:11px;color:var(--text-muted)">Could not load language data.</span>';
  }

  // Past incidents from Supabase
  await loadBoardIncidents(proj.name);
}

async function loadBoardIncidents(serviceName) {
  const el = document.getElementById('board-incidents');
  try {
    const { data } = await supabase
      .from('incidents')
      .select('id, service, severity, status, started_at')
      .eq('service', serviceName)
      .order('started_at', { ascending: false })
      .limit(15);

    const rows = data ?? [];
    document.getElementById('bs-incidents').textContent = rows.length;

    if (rows.length === 0) {
      el.innerHTML = '<span style="font-size:11px;color:var(--green)">✓ No incidents recorded.</span>';
      return;
    }

    el.innerHTML = rows.map(inc => {
      const resolved = inc.status === 'resolved';
      return `
        <div class="board-inc-row">
          <span class="board-inc-id">${escapeHtml(inc.id)}</span>
          <span class="board-inc-date">${inc.started_at ? inc.started_at.split('T')[0] : '—'}</span>
          <span class="board-inc-status" style="${resolved
            ? 'background:rgba(34,197,94,0.12);color:var(--green)'
            : 'background:rgba(239,68,68,0.12);color:var(--red)'
          }">${(inc.status ?? 'unknown').toUpperCase()}</span>
        </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">Could not load incidents.</span>';
    console.error('[Board] loadBoardIncidents:', err);
  }
}

function drawBoardSparkline() {
  const canvas = document.getElementById('board-sparkline');
  if (!canvas) return;
  const W = canvas.parentElement?.offsetWidth - 28 || 400;
  const H = 90;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const pts = Array.from({ length: 30 }, () => Math.floor(Math.random() * 320) + 60);
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const xStep = W / (pts.length - 1);
  const yFor  = v => H - 8 - ((v - min) / range) * (H - 20);

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(79,142,247,0.25)');
  grad.addColorStop(1, 'rgba(79,142,247,0)');

  ctx.clearRect(0, 0, W, H);

  // Fill
  ctx.beginPath();
  ctx.moveTo(0, yFor(pts[0]));
  pts.forEach((v,i) => ctx.lineTo(i * xStep, yFor(v)));
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(0, yFor(pts[0]));
  pts.forEach((v,i) => ctx.lineTo(i * xStep, yFor(v)));
  ctx.strokeStyle = '#4f8ef7'; ctx.lineWidth = 1.5; ctx.stroke();

  // Dots at each point
  pts.forEach((v,i) => {
    ctx.beginPath();
    ctx.arc(i * xStep, yFor(v), 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(79,142,247,0.5)'; ctx.fill();
  });

  // Last point highlighted
  const lx = (pts.length-1)*xStep, ly = yFor(pts[pts.length-1]);
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI*2);
  ctx.fillStyle = '#4f8ef7'; ctx.fill();

  // Y-axis labels
  ctx.fillStyle = 'rgba(107,107,122,0.8)';
  ctx.font = '9px system-ui';
  ctx.fillText(max + 'ms', 4, 14);
  ctx.fillText(min + 'ms', 4, H - 4);
}

/* ─────────────────────────────────────────────
   SECTION 18: BOOT
   Initialize everything on DOMContentLoaded.
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

  // ── Check for an existing Supabase session ───────────────
  // If the user already signed in (session persisted in localStorage),
  // skip the auth overlay entirely.
  const session = await getSession();
  if (session && session.user) {
    await onSignedIn(session.user);
  }
  // If no session, the auth overlay stays visible (default state).

  // ── Supabase: load persisted data on startup ─────────────
  // Only runs after sign-in; fetchIncidents/fetchPostmortems
  // are also called inside onSignedIn → loadProjects chain,
  // but incident/postmortem data is global (not per-user).

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
      id:                 activeInDB.id,
      service:            activeInDB.service,
      errorType:          activeInDB.error_type ?? 'Unknown',
      severity:           activeInDB.severity   ?? 'HIGH',
      startTime:          activeInDB.started_at
                            ? new Date(activeInDB.started_at).toLocaleString()
                            : '—',
      tl1: '—', tl2: '—', tl3: '—', tl4: null,
      resolved:           false,
      engineerTookControl: false,
    };
    const svc = services.find(s => s.id === activeInDB.service);
    if (svc) svc.status = 'critical';
    renderServiceGrid();
    updateStatCards();
    renderIncidentCard();
    document.getElementById('incident-badge').style.display = 'inline';
  }

  // ── Supabase Realtime: live incident updates ─────────────
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

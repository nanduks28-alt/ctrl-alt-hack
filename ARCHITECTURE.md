# SRE-Bot Architecture Documentation

## 🏗️ Complete System Architecture

This document explains the complete end-to-end architecture of the SRE-Bot incident response system, including how all components work together.

---

## 📊 System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Dashboard   │  │   Incidents  │  │ Bob Analysis │          │
│  │  (index.html)│  │   (app.js)   │  │   (app.js)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│         └──────────────────┴──────────────────┘                   │
│                            │                                      │
│                   ┌────────▼────────┐                            │
│                   │ backend_client.js│                            │
│                   └────────┬────────┘                            │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   SUPABASE      │
                    │  (PostgreSQL +  │
                    │   Realtime)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Realtime       │
                    │  Subscription   │
                    └────────┬────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                   PYTHON ORCHESTRATOR                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  orchestrator_service.py                                  │   │
│  │  - Watches Supabase for new incidents                     │   │
│  │  - Triggers workflow_manager                              │   │
│  └────────────────────┬─────────────────────────────────────┘   │
│                       │                                           │
│  ┌────────────────────▼─────────────────────────────────────┐   │
│  │  workflow_manager.py                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ Stage 1:    │→ │ Stage 2:    │→ │ Stage 3:    │      │   │
│  │  │ Parse Logs  │  │ Recovery    │  │ Bob AI      │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                       │                                           │
│  ┌────────────────────┼─────────────────────────────────────┐   │
│  │  ┌─────────────────▼──────┐  ┌──────────────────────┐   │   │
│  │  │  log_parser.py         │  │  recovery_engine.py  │   │   │
│  │  │  - Analyzes logs       │  │  - Attempts recovery │   │   │
│  │  └────────────────────────┘  └──────────────────────┘   │   │
│  │                                                            │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  bob_connector.py                                   │  │   │
│  │  │  - AI analysis (simulated watsonx/OpenAI)          │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Workflow

### Step-by-Step Incident Response Flow

#### **1. Incident Creation (Frontend)**

**File:** `app.js` → `simulateIncident()`

```javascript
// User clicks "Simulate Incident" button
// Frontend checks if orchestrator is online
const health = await checkOrchestratorHealth()

if (health.online) {
  // REAL WORKFLOW MODE
  await triggerRealWorkflow({
    id: 'INC-0001',
    service: 'payment-api',
    error_type: 'timeout',
    severity: 'CRITICAL',
    status: 'pending_analysis',  // ← Triggers orchestrator
    workflow_stage: 'created'
  })
} else {
  // FALLBACK SIMULATION MODE
  // Uses original frontend simulation
}
```

**What happens:**
- Frontend creates incident in Supabase with `status='pending_analysis'`
- This status triggers the Python orchestrator
- Frontend subscribes to realtime updates
- UI shows "Orchestrator processing..."

---

#### **2. Incident Detection (Orchestrator)**

**File:** `orchestrator_service.py`

```python
# Orchestrator watches Supabase via realtime subscription
def _handle_new_incident(self, incident):
    # New incident detected with status='pending_analysis'
    incident_id = incident.get('id')
    
    # Log detection
    logger.incident_detected(incident_id, service, error_type, severity)
    
    # Trigger workflow
    asyncio.create_task(self._process_incident_safe(incident))
```

**Console Output:**
```
[13:20:15] 🔔 NEW INCIDENT DETECTED
           ID: INC-0001
           Service: payment-api
           Error: timeout
           Severity: CRITICAL

[13:20:15] 🚀 WORKFLOW STARTED: INC-0001
```

---

#### **3. Workflow Execution (Workflow Manager)**

**File:** `workflow_manager.py` → `process_incident()`

##### **Stage 1: Parse Logs**

```python
# Analyze incident logs for error patterns
log_analysis = _parse_logs(logs, service_name, error_type)

# Uses log_parser.py
error_count = detect_errors_in_logs(logs, ERROR_KEYWORDS)
is_critical = error_count > 3

# Update Supabase
update_workflow_stage(incident_id, 'logs_parsed')
```

**Console Output:**
```
━━━ Stage 1/4: Log Analysis ━━━
[13:20:16]   📝 Analyzing incident logs...
[13:20:17]   ✅ Analysis complete
[13:20:17]   📊 Errors detected: 5
[13:20:17]   ⚠️  Critical threshold exceeded
```

**Supabase Update:**
```sql
UPDATE incidents SET
  workflow_stage = 'logs_parsed',
  processed_at = NOW()
WHERE id = 'INC-0001'
```

---

##### **Stage 2: Attempt Recovery**

```python
# Try automatic recovery
recovery_result = _attempt_recovery(service_name, error_type)

# Uses recovery_engine.py
result = attempt_recovery('payment-api', 'timeout')
# Returns: { success: False, action: 'Service restart', message: '...' }

# Update Supabase
update_workflow_stage(incident_id, 'recovery_attempted', {
    'recovery_attempted': True,
    'recovery_action': recovery_result['action']
})
```

**Console Output:**
```
━━━ Stage 2/4: Recovery Attempt ━━━
[13:20:18]   🔧 Attempting automatic recovery...
[13:20:18]   🔄 Service: payment-api
[13:20:18]   🔄 Error type: timeout
[13:20:21]   ❌ Recovery failed: Service restart
[13:20:21]   📈 Escalating to AI analysis...
```

**Decision Point:**
- If `recovery_result['success'] == True` → Skip to Stage 4 (mark resolved)
- If `recovery_result['success'] == False` → Continue to Stage 3 (Bob AI)

---

##### **Stage 3: Bob AI Analysis** (if recovery failed)

```python
# Escalate to Bob AI
update_workflow_stage(incident_id, 'escalating_to_bob')

bob_result = _escalate_to_bob(service_name, error_type, logs, recovery_result)

# Uses bob_connector.py
result = analyze_incident(
    service_name='payment-api',
    error_type='timeout',
    logs=logs,
    recovery_attempted=True,
    recovery_action='Service restart'
)
# Returns: {
#   root_cause: 'Database connection pool exhaustion...',
#   suggested_fix: 'Reduce pool size from 100 to 50...',
#   confidence: 91,
#   severity: 'CRITICAL'
# }
```

**Console Output:**
```
━━━ Stage 3/4: Bob AI Analysis ━━━
[13:20:22]   🤖 Sending to Bob AI...
[13:20:24]   📊 Root cause identified
[13:20:24]   💡 Suggested fix generated
[13:20:24]   🎯 Confidence: 91%
[13:20:24]   ✅ Analysis complete
```

---

##### **Stage 4: Update Database**

```python
# Save results to Supabase
mark_incident_analyzed(
    incident_id,
    root_cause=bob_result['root_cause'],
    suggested_fix=bob_result['suggested_fix'],
    confidence=bob_result['confidence'],
    recovery_attempted=True,
    recovery_action=recovery_result['action']
)
```

**Console Output:**
```
━━━ Stage 4/4: Update Database ━━━
[13:20:25]   💾 Saving results to Supabase...
[13:20:25]   ✅ Incident updated

[13:20:25] 🎉 WORKFLOW COMPLETE: INC-0001
           Duration: 10.0 seconds
           Status: analyzed
           Next: Engineer review
```

**Supabase Update:**
```sql
UPDATE incidents SET
  status = 'analyzed',
  workflow_stage = 'completed',
  root_cause = 'Database connection pool exhaustion...',
  suggested_fix = 'Reduce pool size from 100 to 50...',
  confidence = 91,
  recovery_attempted = true,
  recovery_action = 'Service restart',
  processed_at = NOW()
WHERE id = 'INC-0001'
```

---

#### **4. Frontend Updates (Realtime)**

**File:** `app.js` → `handleWorkflowUpdate()`

```javascript
// Supabase Realtime triggers callback
subscribeToWorkflowUpdates(incidentId, (update) => {
  // update = {
  //   stage: 'completed',
  //   status: 'analyzed',
  //   rootCause: '...',
  //   suggestedFix: '...',
  //   confidence: 91
  // }
  
  // Update UI with real results
  document.getElementById('bob-root-cause').textContent = update.rootCause
  document.getElementById('bob-fix').textContent = update.suggestedFix
  document.getElementById('bob-confidence-fill').style.width = `${update.confidence}%`
  
  // Show completion message
  addLogEntry('🤖 Bob AI analysis complete!', 'ok')
  addLogEntry(`Root cause: ${update.rootCause}`, 'info')
  addLogEntry(`Confidence: ${update.confidence}%`, 'info')
})
```

**UI Updates:**
- Activity log shows workflow progress
- Bob Investigation page displays real analysis
- Incident card shows completion status
- Engineer can review and take action

---

## 📁 File Structure & Responsibilities

### Frontend Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `index.html` | Main UI structure | Dashboard layout, incident cards, Bob investigation |
| `styles.css` | Styling | Cyberpunk theme, animations, responsive design |
| `app.js` | Application logic | Incident simulation, UI updates, navigation |
| `supabase.js` | Database operations | CRUD operations, realtime subscriptions |
| `backend_client.js` | Orchestrator integration | Health checks, workflow triggers, realtime updates |

### Backend Files (Python)

| File | Purpose | Key Functions |
|------|---------|---------------|
| `orchestrator_service.py` | Main service | Watches Supabase, triggers workflows, health monitoring |
| `workflow_manager.py` | Workflow orchestration | Executes 4-stage workflow, coordinates components |
| `supabase_client.py` | Python Supabase client | Database operations, incident CRUD, subscriptions |
| `workflow_logger.py` | Console logging | Beautiful colored output, structured logging |
| `log_parser.py` | Log analysis | Detects error patterns, counts errors, identifies critical issues |
| `recovery_engine.py` | Automatic recovery | Simulates recovery attempts, returns success/failure |
| `bob_connector.py` | AI analysis | Simulates AI analysis (watsonx/OpenAI style) |

### Configuration Files

| File | Purpose |
|------|---------|
| `.env` | Environment variables (Supabase credentials) |
| `.env.example` | Template for environment variables |
| `requirements.txt` | Python dependencies |
| `schema.sql` | Database schema with workflow fields |

### Utility Files

| File | Purpose |
|------|---------|
| `start_orchestrator.sh` | Linux/Mac startup script |
| `start_orchestrator.bat` | Windows startup script |
| `test_workflow.py` | End-to-end testing suite |
| `ARCHITECTURE.md` | This documentation |
| `README.md` | Project overview and setup |
| `AGENTS.md` | AI agent guidelines |

---

## 🗄️ Database Schema

### Incidents Table

```sql
CREATE TABLE incidents (
  id                TEXT PRIMARY KEY,           -- e.g. "INC-0001"
  service           TEXT NOT NULL,              -- affected service
  error_type        TEXT,                       -- error description
  severity          TEXT DEFAULT 'HIGH',        -- CRITICAL | HIGH | MEDIUM
  status            TEXT DEFAULT 'active',      -- active | pending_analysis | analyzed | resolved
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  logs              TEXT,                       -- raw log dump
  commits           JSONB,                      -- recent commits
  root_cause        TEXT,                       -- Bob's analysis
  suggested_fix     TEXT,                       -- Bob's recommendation
  confidence        INT,                        -- Bob's confidence (0-100)
  
  -- Workflow fields
  workflow_stage    TEXT DEFAULT 'created',     -- created | logs_parsed | recovery_attempted | escalating_to_bob | completed | error
  recovery_attempted BOOLEAN DEFAULT FALSE,
  recovery_action   TEXT,                       -- recovery action taken
  processed_at      TIMESTAMPTZ,                -- when orchestrator processed
  orchestrator_logs JSONB                       -- detailed workflow logs
);
```

### Workflow Stages

| Stage | Description | Next Stage |
|-------|-------------|------------|
| `created` | Incident created, waiting for orchestrator | `logs_parsed` |
| `logs_parsed` | Log analysis complete | `recovery_attempted` |
| `recovery_attempted` | Recovery tried | `escalating_to_bob` or `completed` |
| `escalating_to_bob` | AI analysis in progress | `completed` |
| `completed` | Workflow finished | - |
| `error` | Workflow encountered error | - |

---

## 🔌 API Integration Points

### Frontend → Supabase

```javascript
// Create incident (triggers orchestrator)
await supabase.from('incidents').insert({
  id: 'INC-0001',
  status: 'pending_analysis',  // ← Key trigger
  workflow_stage: 'created'
})

// Subscribe to updates
supabase.channel('incidents-realtime')
  .on('postgres_changes', { event: 'UPDATE', table: 'incidents' }, callback)
  .subscribe()
```

### Orchestrator → Supabase

```python
# Watch for new incidents
client.subscribe_to_incidents(callback)

# Update workflow stage
client.update_workflow_stage(incident_id, 'logs_parsed')

# Mark as analyzed
client.mark_incident_analyzed(
    incident_id,
    root_cause='...',
    suggested_fix='...',
    confidence=91
)
```

---

## 🚀 Running the System

### 1. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your Supabase credentials
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_ANON_KEY=your-anon-key-here
```

### 2. Install Dependencies

```bash
# Python dependencies
pip install -r requirements.txt

# Or use the startup script (auto-installs)
chmod +x start_orchestrator.sh
```

### 3. Run Database Schema

```sql
-- In Supabase SQL Editor, run schema.sql
-- This creates tables with workflow fields
```

### 4. Start Orchestrator

```bash
# Linux/Mac
./start_orchestrator.sh

# Windows
start_orchestrator.bat

# Or directly
python orchestrator_service.py
```

**Expected Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  🤖 SRE-Bot Orchestrator Service v1.0.0                      ║
║  Intelligent Incident Response Automation                    ║
╚══════════════════════════════════════════════════════════════╝

[13:20:00] 🔌 Connecting to Supabase...
[13:20:00] ✅ Connected: https://tniqhojcyzfqzcqdaoxi.supabase.co
[13:20:00] 🔍 Checking for existing pending incidents...
[13:20:00] ℹ️  No pending incidents found
[13:20:00] 📡 Setting up realtime subscription...
[13:20:00] ✅ Subscribed to incidents table (realtime)
[13:20:00] 💚 Orchestrator ready
[13:20:00] 👂 Listening for incidents...
```

### 5. Open Frontend

```bash
# Open index.html in browser
# Or use a local server
python -m http.server 8000
# Navigate to http://localhost:8000
```

### 6. Simulate Incident

1. Click "Simulate Incident" button
2. Frontend checks orchestrator health
3. If online: Creates incident with `status='pending_analysis'`
4. Orchestrator detects and processes
5. Frontend receives realtime updates
6. Results displayed in Bob Investigation page

---

## 🧪 Testing

### Run Test Suite

```bash
python test_workflow.py
```

**Test Flow:**
1. ✅ Test Supabase connection
2. ✅ Create test incident
3. ✅ Execute workflow
4. ✅ Verify results
5. ✅ Cleanup test data

**Expected Output:**
```
🧪 SRE-Bot Workflow Test Suite
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TEST 1: Supabase Connection
✅ Supabase connection successful

TEST 2: Create Test Incident
✅ Test incident created: TEST-1234567890

TEST 3: Workflow Execution
🚀 WORKFLOW STARTED: TEST-1234567890
━━━ Stage 1/4: Log Analysis ━━━
━━━ Stage 2/4: Recovery Attempt ━━━
━━━ Stage 3/4: Bob AI Analysis ━━━
━━━ Stage 4/4: Update Database ━━━
🎉 WORKFLOW COMPLETE
✅ Workflow executed successfully

TEST 4: Verify Results
  ✅ Workflow stage: completed
  ✅ Status: analyzed
  ✅ Recovery attempted
  ✅ Root cause identified
  ✅ Processed timestamp set
✅ All verification checks passed

TEST 5: Cleanup
✅ Test incident deleted

TEST SUMMARY
  Total tests:  5
  Passed:       5 ✅
  Failed:       0 ❌
  Pass rate:    100.0%

🎉 ALL TESTS PASSED! ✅
```

---

## 🔄 Workflow Modes

### Real Workflow Mode (Orchestrator Online)

**When:** Orchestrator service is running
**Flow:** Frontend → Supabase → Orchestrator → Workflow → Supabase → Frontend
**Features:**
- Real log parsing
- Actual recovery attempts
- AI analysis simulation
- Structured workflow stages
- Realtime progress updates

### Simulation Mode (Orchestrator Offline)

**When:** Orchestrator service is not running
**Flow:** Frontend → Supabase → Frontend (simulated)
**Features:**
- Frontend-only simulation
- Hardcoded delays
- Predefined results
- No real workflow execution
- Fallback for development/demo

---

## 🎯 Key Design Decisions

### 1. Supabase-Only Backend

**Why:** No separate API server needed
- Supabase handles all backend operations
- Realtime subscriptions for live updates
- PostgreSQL for data persistence
- Row-level security for auth

### 2. Python Orchestrator Service

**Why:** Separate service for workflow orchestration
- Watches Supabase for new incidents
- Coordinates existing Python scripts
- Modular and maintainable
- Easy to deploy independently

### 3. Realtime Communication

**Why:** Instant updates without polling
- Supabase Realtime for push updates
- Frontend sees workflow progress live
- No need for REST API polling
- Efficient and scalable

### 4. Workflow Stages

**Why:** Clear progress tracking
- Each stage updates Supabase
- Frontend can show progress
- Easy to debug and monitor
- Supports partial completion

### 5. Fallback Mode

**Why:** Works with or without orchestrator
- Development without running Python
- Demo mode for presentations
- Graceful degradation
- Better user experience

---

## 🔧 Troubleshooting

### Orchestrator Not Detecting Incidents

**Check:**
1. Is orchestrator running? (`python orchestrator_service.py`)
2. Are Supabase credentials correct in `.env`?
3. Is incident created with `status='pending_analysis'`?
4. Check orchestrator console for errors

### Frontend Not Receiving Updates

**Check:**
1. Is Supabase Realtime enabled? (`alter publication supabase_realtime add table incidents;`)
2. Are you subscribed to the correct channel?
3. Check browser console for errors
4. Verify incident ID matches

### Workflow Stuck at Stage

**Check:**
1. Orchestrator console for errors
2. Supabase `workflow_stage` field
3. Python script errors (log_parser, recovery_engine, bob_connector)
4. Database connection issues

### Dependencies Not Installing

**Check:**
1. Python version (3.7+ required)
2. pip is up to date (`pip install --upgrade pip`)
3. Virtual environment activated
4. Internet connection for package downloads

---

## 🚀 Production Deployment

### Orchestrator Deployment

**Options:**
1. **Cloud VM** (AWS EC2, Google Compute, Azure VM)
   - Run as systemd service
   - Auto-restart on failure
   - Log to file

2. **Container** (Docker)
   - Dockerfile with Python + dependencies
   - Deploy to Kubernetes, ECS, Cloud Run

3. **Serverless** (AWS Lambda, Google Cloud Functions)
   - Trigger on Supabase webhook
   - Stateless execution

### Frontend Deployment

**Options:**
1. **Static Hosting** (Vercel, Netlify, GitHub Pages)
   - Deploy HTML/CSS/JS directly
   - CDN distribution
   - HTTPS included

2. **Cloud Storage** (S3, GCS, Azure Blob)
   - Static website hosting
   - CloudFront/CDN

### Environment Variables

**Production:**
- Use secrets management (AWS Secrets Manager, Google Secret Manager)
- Never commit `.env` to git
- Rotate credentials regularly
- Use separate Supabase projects for dev/prod

---

## 📈 Future Enhancements

### Planned Features

1. **Real AI Integration**
   - Connect to actual watsonx Orchestrate
   - OpenAI GPT-4 integration
   - Azure OpenAI support

2. **Multi-Tenant Support**
   - Team-based incident management
   - Role-based access control
   - Organization isolation

3. **Advanced Analytics**
   - Incident trends
   - MTTR metrics
   - Recovery success rates

4. **Notification System**
   - Email alerts
   - Slack integration
   - PagerDuty integration

5. **Runbook Automation**
   - Automated remediation scripts
   - Approval workflows
   - Audit logging

---

## 📚 Additional Resources

- **Supabase Docs:** https://supabase.com/docs
- **Python asyncio:** https://docs.python.org/3/library/asyncio.html
- **watsonx Orchestrate:** https://www.ibm.com/products/watsonx-orchestrate

---

## 🤝 Contributing

See `AGENTS.md` for AI agent guidelines when working with this codebase.

---

## 📝 License

Made with Bob - SRE-Bot Team

---

**Last Updated:** 2026-05-17
**Version:** 1.0.0
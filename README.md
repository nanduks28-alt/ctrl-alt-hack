# UpTimeX — AI-Powered Incident Response Dashboard

**Live Demo → [https://ctrl-alt-hack-phi.vercel.app](https://ctrl-alt-hack-phi.vercel.app)**

> Real-time monitoring, automated recovery, and AI root cause analysis for your live projects.

---

## What is UpTimeX?

UpTimeX is a full-stack incident response platform that watches your deployed projects 24/7. When something goes down, it automatically attempts recovery, escalates to an AI (Bob) for root cause analysis, and generates a postmortem — all without you having to do anything.

You register your GitHub repo and live demo URL. UpTimeX does the rest.

---

## Features

- **Email OTP auth** — passwordless sign-in, no accounts to manage
- **Project monitoring** — register any GitHub repo + live URL, monitor agent polls every 30s
- **Real incident detection** — HTTP health checks detect outages, slow responses, and 5xx errors
- **Automated recovery** — waits for auto-restart, triggers GitHub Actions redeploy if available
- **Bob AI analysis** — escalates to Claude (Anthropic) for root cause analysis when recovery fails
- **Live dashboard** — real-time incident feed, service health grid, response time charts
- **Project overview board** — click any service card to see repo files, commits, language breakdown, past incidents
- **Postmortem generation** — one-click postmortem with timeline, RCA, and prevention actions
- **Export to Markdown** — download any postmortem as a `.md` file
- **Supabase Realtime** — all updates push instantly to every connected browser

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES6 modules), HTML5, CSS3 |
| Backend | Supabase (PostgreSQL + Realtime + Auth) |
| Monitor Agent | Python 3 + aiohttp |
| AI Analysis | Anthropic Claude (claude-haiku) |
| Deployment | Vercel (frontend) |

No frameworks. No build tools. No npm. Just files.

---

## Project Structure

```
uptimex/
├── index.html          # Single-page app shell
├── styles.css          # All styling
├── app.js              # Frontend logic (ES6 module)
├── supabase.js         # Supabase client + all DB operations
├── backend_client.js   # Frontend ↔ orchestrator bridge
│
├── orchestrator_service.py   # Main Python service (watches Supabase)
├── monitor_agent.py          # HTTP health checker for registered projects
├── workflow_manager.py       # 4-stage incident workflow orchestration
├── bob_connector.py          # Anthropic Claude AI integration
├── recovery_engine.py        # Automated recovery attempts
├── log_parser.py             # Log analysis utilities
├── supabase_client.py        # Python Supabase wrapper
├── workflow_logger.py        # Structured console logging
│
├── schema.sql          # Run this in Supabase SQL Editor
├── requirements.txt    # Python dependencies
├── .env.example        # Environment variable template
└── vercel.json         # Vercel deployment config
```

---

## How It Works

```
Your Project Goes Down
        ↓
Monitor Agent detects failure (HTTP check every 30s)
        ↓
Incident created in Supabase → Frontend updates in real-time
        ↓
Recovery Engine attempts auto-fix
  ├── Wait 15s → re-check (auto-restart?)
  └── Trigger GitHub Actions redeploy (if GITHUB_TOKEN set)
        ↓
If recovery fails → Bob AI (Claude) analyzes logs + commits
        ↓
Root cause, suggested fix, confidence score → saved to Supabase
        ↓
Frontend shows results → Generate Postmortem → Export Markdown
```

---

## Getting Started

### 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `schema.sql`
3. Go to **Authentication → Providers → Email** → enable **Email OTP**, disable magic link
4. Copy your **Project URL** and **anon key** from **Project Settings → API**

### 2. Configure Credentials

Open `supabase.js` and replace the placeholders:

```js
const SUPABASE_URL      = 'https://your-project.supabase.co'
const SUPABASE_ANON_KEY = 'your-anon-key-here'
```

### 3. Run the Frontend

Open `index.html` with a local server (required for ES modules):

```bash
# Python
python -m http.server 3000

# Then open http://localhost:3000
```

### 4. Run the Python Monitor (optional but recommended)

```bash
cp .env.example .env
# Edit .env with your Supabase credentials

pip install -r requirements.txt
python orchestrator_service.py
```

Once running, register a project in the dashboard — the monitor agent starts checking it every 30 seconds automatically.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | Your Supabase anon/public key |
| `ANTHROPIC_API_KEY` | Optional | Enables real Claude AI analysis (falls back to simulation without it) |
| `GITHUB_TOKEN` | Optional | Enables GitHub Actions redeploy recovery |
| `MONITOR_INTERVAL_SECONDS` | Optional | Health check frequency (default: 30) |
| `MONITOR_TIMEOUT_SECONDS` | Optional | Request timeout (default: 10) |

---

## Deploying to Vercel

```bash
npm install -g vercel
vercel --prod
```

After deploying, add your Vercel URL to Supabase:
**Authentication → URL Configuration → Redirect URLs**

```
https://your-app.vercel.app
https://your-app.vercel.app/**
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `incidents` | All triggered incidents with workflow state and Bob's analysis |
| `postmortems` | Generated postmortem reports |
| `projects` | User-registered GitHub repos (per-user, RLS protected) |
| `monitored_projects` | Mirror of projects for the Python monitor agent |
| `orchestrator_heartbeat` | Liveness tracking for the Python service |

---

## Adding a Project

1. Sign in with your email (6-digit OTP)
2. Go to **My Projects → Add Project**
3. Paste your GitHub repo URL and live demo URL
4. UpTimeX verifies GitHub ownership against your sign-in email
5. The monitor agent starts watching your live URL within 30 seconds

---

## Built for

[ctrl-alt-hack hackathon](https://github.com/rijulmenon/ctrl-alt-hack) — May 2026

---

*UpTimeX — because downtime shouldn't require a human to notice it first.*

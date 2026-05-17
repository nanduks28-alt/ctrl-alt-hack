-- =============================================================
-- SRE-Bot — Supabase Schema
-- Run this in your Supabase project's SQL Editor.
-- Dashboard → SQL Editor → New Query → paste → Run
-- =============================================================

-- ── INCIDENTS TABLE ──────────────────────────────────────────
-- Stores every triggered incident, its status, and Bob's analysis.
create table incidents (
  id                text        primary key,                    -- e.g. "INC-0001"
  service           text        not null,                       -- affected service name
  error_type        text,                                       -- short error description
  severity          text        default 'HIGH',                 -- CRITICAL | HIGH | MEDIUM
  status            text        default 'active',               -- active | resolved | pending_analysis | analyzed
  started_at        timestamptz default now(),                  -- when the incident began
  resolved_at       timestamptz,                                -- when it was resolved (nullable)
  logs              text,                                       -- raw log dump as text
  commits           jsonb,                                      -- recent commits array
  root_cause        text,                                       -- Bob's root cause finding
  suggested_fix     text,                                       -- Bob's suggested fix
  confidence        int,                                        -- Bob's confidence 0–100
  
  -- Workflow orchestration fields
  workflow_stage    text        default 'created',              -- created | logs_parsed | recovery_attempted | escalating_to_bob | completed | error
  recovery_attempted boolean    default false,                  -- whether recovery was attempted
  recovery_action   text,                                       -- recovery action taken
  processed_at      timestamptz,                                -- when orchestrator processed this
  orchestrator_logs jsonb                                       -- detailed orchestrator logs
);

-- ── POSTMORTEMS TABLE ────────────────────────────────────────
-- Stores generated postmortem reports linked to incidents.
create table postmortems (
  id                 uuid        primary key default gen_random_uuid(),
  incident_id        text        references incidents(id),  -- FK to incidents
  service            text,
  root_cause         text,
  timeline           jsonb,                                 -- array of { time, event }
  prevention_actions jsonb,                                 -- array of action strings
  created_at         timestamptz default now()
);

-- ── REALTIME ─────────────────────────────────────────────────
-- Enable Supabase Realtime for the incidents table so the
-- dashboard receives live INSERT/UPDATE events.
alter publication supabase_realtime add table incidents;

-- ── PROJECTS TABLE ───────────────────────────────────────────
-- Stores user-registered projects (repo + live demo links).
-- user_id links to Supabase Auth users.
create table projects (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  name          text        not null,                           -- derived from repo URL
  repo_url      text        not null,                          -- GitHub repo URL
  demo_url      text,                                          -- live demo URL
  github_email  text,                                          -- must match GitHub account email
  created_at    timestamptz default now()
);

-- Only the owning user can read/write their own projects (RLS)
alter table projects enable row level security;

create policy "Users can manage their own projects"
  on projects for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── RLS FOR INCIDENTS & POSTMORTEMS ─────────────────────────
-- Any authenticated user can read/write incidents and postmortems.
-- (These are team-wide, not per-user.)
alter table incidents  enable row level security;
alter table postmortems enable row level security;

create policy "Authenticated users can manage incidents"
  on incidents for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can manage postmortems"
  on postmortems for all
  to authenticated
  using (true)
  with check (true);

-- ── MONITORED PROJECTS TABLE ─────────────────────────────
-- Mirrors projects table but readable by orchestrator without auth context
-- Used by monitor_agent.py for real-time health monitoring
create table monitored_projects (
  id                     uuid        primary key default gen_random_uuid(),
  project_id             uuid        references projects(id) on delete cascade,
  name                   text        not null,
  repo_url               text        not null,
  demo_url               text        not null,
  check_interval_seconds int         default 30,
  last_checked           timestamptz,
  last_status            text        default 'unknown',
  is_active              boolean     default true,
  created_at             timestamptz default now()
);

alter table monitored_projects enable row level security;

create policy "Authenticated users can manage monitored_projects"
  on monitored_projects for all
  to authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table monitored_projects;

-- ── ORCHESTRATOR HEARTBEAT TABLE ──────────────────────────
-- Tracks orchestrator liveness for frontend health checks
create table orchestrator_heartbeat (
  id         text        primary key default 'singleton',
  last_ping  timestamptz default now(),
  version    text
);

insert into orchestrator_heartbeat (id, version) values ('singleton', '1.0.0')
on conflict (id) do nothing;

alter table orchestrator_heartbeat enable row level security;

create policy "Authenticated users can read orchestrator_heartbeat"
  on orchestrator_heartbeat for select
  to authenticated
  using (true);

create policy "Service role can update orchestrator_heartbeat"
  on orchestrator_heartbeat for update
  to authenticated
  using (true)
  with check (true);

-- ── ALLOW ANON READS ON MONITORED_PROJECTS ───────────────────
-- The Python orchestrator uses the anon key, so it needs read access.
-- Writes are still restricted to authenticated users.
create policy "Anon can read monitored_projects"
  on monitored_projects for select
  to anon
  using (true);

-- Allow anon to update last_checked and last_status (monitor agent)
create policy "Anon can update monitor status"
  on monitored_projects for update
  to anon
  using (true)
  with check (true);

-- Allow anon to read incidents (orchestrator needs to fetch pending ones)
create policy "Anon can read incidents"
  on incidents for select
  to anon
  using (true);

-- Allow anon to update incidents (orchestrator writes analysis results)
create policy "Anon can update incidents"
  on incidents for update
  to anon
  using (true)
  with check (true);

-- Allow anon to insert postmortems
create policy "Anon can insert postmortems"
  on postmortems for insert
  to anon
  with check (true);

-- Allow anon to update orchestrator_heartbeat
create policy "Anon can update heartbeat"
  on orchestrator_heartbeat for all
  to anon
  using (true)
  with check (true);

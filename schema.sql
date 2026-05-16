-- =============================================================
-- SRE-Bot — Supabase Schema
-- Run this in your Supabase project's SQL Editor.
-- Dashboard → SQL Editor → New Query → paste → Run
-- =============================================================

-- ── INCIDENTS TABLE ──────────────────────────────────────────
-- Stores every triggered incident, its status, and Bob's analysis.
create table incidents (
  id            text        primary key,                    -- e.g. "INC-0001"
  service       text        not null,                       -- affected service name
  error_type    text,                                       -- short error description
  severity      text        default 'HIGH',                 -- CRITICAL | HIGH | MEDIUM
  status        text        default 'active',               -- active | resolved
  started_at    timestamptz default now(),                  -- when the incident began
  resolved_at   timestamptz,                                -- when it was resolved (nullable)
  logs          text,                                       -- raw log dump as text
  commits       jsonb,                                      -- recent commits array
  root_cause    text,                                       -- Bob's root cause finding
  suggested_fix text,                                       -- Bob's suggested fix
  confidence    int                                         -- Bob's confidence 0–100
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

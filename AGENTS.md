# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview
SRE-Bot: AI-powered incident response dashboard with Supabase backend and vanilla JavaScript frontend.

## Stack
- **Frontend**: Vanilla JavaScript (ES6 modules), HTML5, CSS3
- **Backend**: Supabase (PostgreSQL + Realtime + Auth)
- **Python Scripts**: Python 3 with supabase-py library

## Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your Supabase credentials:
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_ANON_KEY=your-anon-key-here

# For Python scripts, install dependencies:
pip install supabase-py python-dotenv
```

## Running the Application
- **Frontend**: Open `index.html` in a browser or use a local server
- **Python Log Parser**: `python log_parser.py`

## Database Schema
Run `schema.sql` in Supabase SQL Editor to create tables:
- **incidents**: Stores triggered incidents with Bob's analysis
- **postmortems**: Generated postmortem reports
- **projects**: User-registered GitHub repos with live demo links

## Code Style
- **JavaScript**: ES6 modules, async/await for Supabase calls
- **Imports**: Use CDN imports for Supabase client (`@supabase/supabase-js/+esm`)
- **Error Handling**: Always wrap Supabase calls in try-catch, return null/empty arrays on error
- **Python**: Follow PEP 8, use type hints, comprehensive docstrings

## Key Patterns
- **Supabase Client**: Created once in `supabase.js`, exported for use in `app.js`
- **Realtime**: Use `subscribeToIncidents()` for live updates on incidents table
- **Auth Flow**: OTP-based (magic link), no passwords
- **State Management**: Global `state` object in `app.js` tracks incidents, projects, user session
- **Environment Variables**: Python scripts read from `.env`, JavaScript has hardcoded credentials (should use env in production)

## Critical Notes
- **Credentials**: `supabase.js` contains hardcoded credentials (lines 13-14) - these should be moved to environment variables in production
- **RLS Policies**: Incidents/postmortems are team-wide (any authenticated user), projects are user-specific
- **Realtime**: Must enable publication on incidents table: `alter publication supabase_realtime add table incidents;`
- **Python Log Parser**: Works with incidents table, not a separate logs table - parses the `logs` text column
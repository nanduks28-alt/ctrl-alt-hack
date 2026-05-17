/* =============================================================
   SRE-Bot — Supabase Integration Layer
   supabase.js — All database operations. Import from app.js.
   ============================================================= */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

/* ─────────────────────────────────────────────
   CREDENTIALS
   Replace these with your actual Supabase project values.
   Never commit real credentials — use .env files in production.
───────────────────────────────────────────── */
const SUPABASE_URL      = 'https://tniqhojcyzfqzcqdaoxi.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuaXFob2pjeXpmcXpjcWRhb3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzMxODAsImV4cCI6MjA5NDQwOTE4MH0.nGkNwQWh459aIPBzS-QADuNAVttZQ_ZJqMKfNSbVFeQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/* ─────────────────────────────────────────────
   saveIncident(incidentData)
   Inserts a new row into the "incidents" table.

   Expected shape:
   {
     id          : string   — e.g. "INC-0001"
     service     : string   — e.g. "payment-api"
     error_type  : string
     severity    : string   — "CRITICAL" | "HIGH" | "MEDIUM"
     status      : string   — "active" | "resolved"
     started_at  : string   — ISO timestamp
     logs        : string   — raw log text
     commits     : object[] — array of commit objects
   }

   Returns the inserted row, or null on error.
───────────────────────────────────────────── */
export async function saveIncident(incidentData) {
  try {
    const { data, error } = await supabase
      .from('incidents')
      .insert([incidentData])
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('[Supabase] saveIncident failed:', error.message)
    // Surface the error in the activity log if the function is available
    if (typeof addLogEntry === 'function') {
      addLogEntry('Supabase error: ' + error.message, 'warn')
    }
    return null
  }
}

/* ─────────────────────────────────────────────
   updateIncident(id, updates)
   Updates an existing incident row by its text id.

   Common update shapes:
   { status: 'resolved', resolved_at: new Date().toISOString() }
   { root_cause, suggested_fix, confidence }

   Returns the updated row, or null on error.
───────────────────────────────────────────── */
export async function updateIncident(id, updates) {
  try {
    const { error } = await supabase
      .from('incidents')
      .update(updates)
      .eq('id', id)

    if (error) throw error
    return true
  } catch (error) {
    console.error('[Supabase] updateIncident failed:', error.message)
    if (typeof addLogEntry === 'function') {
      addLogEntry('Supabase error: ' + error.message, 'warn')
    }
    return null
  }
}

/* ─────────────────────────────────────────────
   savePostmortem(postmortemData)
   Inserts a new row into the "postmortems" table.

   Expected shape:
   {
     incident_id        : string   — FK to incidents.id
     service            : string
     root_cause         : string
     timeline           : object[] — array of { time, event }
     prevention_actions : string[] — array of action strings
     created_at         : string   — ISO timestamp
   }

   Returns the inserted row, or null on error.
───────────────────────────────────────────── */
export async function savePostmortem(postmortemData) {
  try {
    const { data, error } = await supabase
      .from('postmortems')
      .insert([postmortemData])
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('[Supabase] savePostmortem failed:', error.message)
    if (typeof addLogEntry === 'function') {
      addLogEntry('Supabase error: ' + error.message, 'warn')
    }
    return null
  }
}

/* ─────────────────────────────────────────────
   fetchIncidents()
   Returns all incidents ordered by started_at descending.
   Returns an empty array on error so the UI never breaks.
───────────────────────────────────────────── */
export async function fetchIncidents() {
  try {
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .order('started_at', { ascending: false })

    if (error) throw error
    return data ?? []
  } catch (error) {
    console.error('[Supabase] fetchIncidents failed:', error.message)
    if (typeof addLogEntry === 'function') {
      addLogEntry('Supabase error: ' + error.message, 'warn')
    }
    return []
  }
}

/* ─────────────────────────────────────────────
   fetchPostmortems()
   Returns all postmortems ordered by created_at descending.
   Returns an empty array on error so the UI never breaks.
───────────────────────────────────────────── */
export async function fetchPostmortems() {
  try {
    const { data, error } = await supabase
      .from('postmortems')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return data ?? []
  } catch (error) {
    console.error('[Supabase] fetchPostmortems failed:', error.message)
    if (typeof addLogEntry === 'function') {
      addLogEntry('Supabase error: ' + error.message, 'warn')
    }
    return []
  }
}

/* ─────────────────────────────────────────────
   subscribeToIncidents(callback)
   Opens a Supabase Realtime channel on the incidents table.
   Fires callback(payload) on INSERT and UPDATE events.

   payload shape from Supabase:
   { eventType: 'INSERT'|'UPDATE', new: rowObject, old: rowObject }

   Returns the channel object so the caller can call
   supabase.removeChannel(channel) to unsubscribe.
───────────────────────────────────────────── */
export function subscribeToIncidents(callback) {
  const channel = supabase
    .channel('incidents-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'incidents' },
      (payload) => {
        // Only forward INSERT and UPDATE events
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          callback(payload)
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Supabase] Realtime subscription active on incidents table.')
      }
      if (status === 'CHANNEL_ERROR') {
        console.error('[Supabase] Realtime subscription error on incidents table.')
      }
    })

  return channel
}

/* ─────────────────────────────────────────────
   AUTH — sendOtp(email)
   Sends a 6-digit magic-link / OTP to the user's email
   via Supabase Auth (OTP flow).
   Returns { error } — null error means email was sent.
───────────────────────────────────────────── */
export async function sendOtp(email) {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    if (error) throw error
    return { error: null }
  } catch (error) {
    console.error('[Supabase] sendOtp failed:', error.message)
    return { error }
  }
}

/* ─────────────────────────────────────────────
   AUTH — verifyOtp(email, token)
   Verifies the 6-digit code the user typed.
   Returns { session, user, error }.
───────────────────────────────────────────── */
export async function verifyOtp(email, token) {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    if (error) throw error
    return { session: data.session, user: data.user, error: null }
  } catch (error) {
    console.error('[Supabase] verifyOtp failed:', error.message)
    return { session: null, user: null, error }
  }
}

/* ─────────────────────────────────────────────
   AUTH — getSession()
   Returns the current session (or null if logged out).
───────────────────────────────────────────── */
export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/* ─────────────────────────────────────────────
   AUTH — signOut()
───────────────────────────────────────────── */
export async function signOut() {
  await supabase.auth.signOut()
}

/* ─────────────────────────────────────────────
   PROJECTS — saveProject(projectData)
   Inserts a project row owned by the current user.

   Shape:
   {
     user_id    : string  — from supabase.auth session
     name       : string  — derived from repo URL
     repo_url   : string  — full GitHub repo URL
     demo_url   : string  — live demo URL
     github_email: string — user's email (must match GitHub)
   }
───────────────────────────────────────────── */
export async function saveProject(projectData) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .insert([projectData])
      .select()
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('[Supabase] saveProject failed:', error.message)
    return null
  }
}

/* ─────────────────────────────────────────────
   verifyGithubOwnership(repoUrl, userEmail)
   Checks the GitHub API to confirm the repo owner's
   public email matches the signed-in user's email.

   Returns:
   { verified: true }                   — emails match, allow save
   { verified: false, githubEmail }     — mismatch, caller should
                                          send OTP to githubEmail
   { verified: false, githubEmail: null, error } — can't determine
───────────────────────────────────────────── */
export async function verifyGithubOwnership(repoUrl, userEmail) {
  try {
    // Extract owner from https://github.com/owner/repo
    const parts = repoUrl.replace('https://github.com/', '').split('/')
    const owner = parts[0]
    if (!owner) return { verified: false, githubEmail: null, error: 'Invalid repo URL' }

    // GitHub public API — no auth needed for public profile
    const res  = await fetch(`https://api.github.com/users/${owner}`)
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
    const user = await res.json()

    const githubEmail = user.email // null if user hasn't made it public

    if (!githubEmail) {
      // Can't verify automatically — GitHub email is private.
      // Return the login so the caller can ask the user to confirm.
      return { verified: false, githubEmail: null, login: user.login }
    }

    if (githubEmail.toLowerCase() === userEmail.toLowerCase()) {
      return { verified: true, githubEmail }
    }

    return { verified: false, githubEmail }
  } catch (error) {
    console.error('[GitHub] verifyGithubOwnership failed:', error.message)
    return { verified: false, githubEmail: null, error: error.message }
  }
}

/* ─────────────────────────────────────────────
   PROJECTS — fetchProjects(userId)
   Returns all projects belonging to the given user.
───────────────────────────────────────────── */
export async function fetchProjects(userId) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  } catch (error) {
    console.error('[Supabase] fetchProjects failed:', error.message)
    return []
  }
}

/* ─────────────────────────────────────────────
   PROJECTS — deleteProject(id)
───────────────────────────────────────────── */
export async function deleteProject(id) {
  try {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
    if (error) throw error
    return true
  } catch (error) {
    console.error('[Supabase] deleteProject failed:', error.message)
    return false
  }
}

/* ─────────────────────────────────────────────
   syncProjectToMonitor(projectId, name, repoUrl, demoUrl)
   Syncs a project to the monitored_projects table
   so the Python monitor agent can track it.
───────────────────────────────────────────── */
export async function syncProjectToMonitor(projectId, name, repoUrl, demoUrl) {
  try {
    // Check if already exists
    const { data: existing } = await supabase
      .from('monitored_projects')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()

    if (existing) return existing

    const { data, error } = await supabase
      .from('monitored_projects')
      .insert([{
        project_id: projectId,
        name,
        repo_url:  repoUrl,
        demo_url:  demoUrl,
        check_interval_seconds: 30,
        is_active: true
      }])
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('[Supabase] syncProjectToMonitor failed:', error.message)
    return null
  }
}

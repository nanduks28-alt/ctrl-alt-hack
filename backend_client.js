/* =============================================================
   Backend Client - Frontend Integration with Orchestrator
   backend_client.js — Connects frontend to Python orchestrator
   ============================================================= */

import { supabase, fetchIncidents } from './supabase.js'

/* ─────────────────────────────────────────────
   ORCHESTRATOR HEALTH CHECK
   Detects if the Python orchestrator is running
   by checking for recently processed incidents.
───────────────────────────────────────────── */
export async function checkOrchestratorHealth() {
  try {
    // Fetch recent incidents
    const incidents = await fetchIncidents()
    
    if (!incidents || incidents.length === 0) {
      return {
        online: false,
        reason: 'no_incidents',
        message: 'No incidents in database yet'
      }
    }
    
    // Check if any incident was processed in the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    const recentlyProcessed = incidents.some(inc => {
      if (!inc.processed_at) return false
      const processedTime = new Date(inc.processed_at)
      return processedTime > fiveMinutesAgo
    })
    
    if (recentlyProcessed) {
      return {
        online: true,
        reason: 'recent_activity',
        message: 'Orchestrator is processing incidents'
      }
    }
    
    // Check if there are pending incidents waiting to be processed
    const hasPending = incidents.some(inc => inc.status === 'pending_analysis')
    
    if (hasPending) {
      return {
        online: false,
        reason: 'pending_unprocessed',
        message: 'Orchestrator appears offline (pending incidents not being processed)'
      }
    }
    
    // No recent activity but no pending either - could be idle
    return {
      online: true,
      reason: 'idle',
      message: 'Orchestrator is idle (no recent incidents)'
    }
    
  } catch (error) {
    console.error('[Backend Client] Health check failed:', error)
    return {
      online: false,
      reason: 'error',
      message: `Health check error: ${error.message}`
    }
  }
}

/* ─────────────────────────────────────────────
   GET WORKFLOW STATUS
   Get the current workflow stage of an incident
───────────────────────────────────────────── */
export async function getWorkflowStatus(incidentId) {
  try {
    const { data, error } = await supabase
      .from('incidents')
      .select('workflow_stage, recovery_attempted, recovery_action, processed_at')
      .eq('id', incidentId)
      .single()
    
    if (error) throw error
    
    return {
      success: true,
      stage: data.workflow_stage || 'created',
      recoveryAttempted: data.recovery_attempted || false,
      recoveryAction: data.recovery_action || null,
      processedAt: data.processed_at || null
    }
    
  } catch (error) {
    console.error('[Backend Client] Failed to get workflow status:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/* ─────────────────────────────────────────────
   WORKFLOW STAGE DESCRIPTIONS
   Human-readable descriptions for each stage
───────────────────────────────────────────── */
export const WORKFLOW_STAGES = {
  created: {
    label: 'Created',
    icon: '🆕',
    description: 'Incident created, waiting for orchestrator',
    color: '#64b5f6'
  },
  logs_parsed: {
    label: 'Logs Analyzed',
    icon: '📝',
    description: 'Log analysis complete',
    color: '#81c784'
  },
  recovery_attempted: {
    label: 'Recovery Attempted',
    icon: '🔧',
    description: 'Automatic recovery in progress',
    color: '#ffb74d'
  },
  escalating_to_bob: {
    label: 'Escalating to Bob AI',
    icon: '🤖',
    description: 'AI analysis in progress',
    color: '#ba68c8'
  },
  completed: {
    label: 'Workflow Complete',
    icon: '✅',
    description: 'Analysis complete, ready for review',
    color: '#66bb6a'
  },
  error: {
    label: 'Workflow Error',
    icon: '❌',
    description: 'Workflow encountered an error',
    color: '#ef5350'
  }
}

/* ─────────────────────────────────────────────
   GET WORKFLOW STAGE INFO
   Get formatted info for a workflow stage
───────────────────────────────────────────── */
export function getWorkflowStageInfo(stage) {
  return WORKFLOW_STAGES[stage] || {
    label: 'Unknown',
    icon: '❓',
    description: 'Unknown workflow stage',
    color: '#9e9e9e'
  }
}

/* ─────────────────────────────────────────────
   TRIGGER REAL WORKFLOW
   Create an incident that will be processed by
   the orchestrator service
───────────────────────────────────────────── */
export async function triggerRealWorkflow(incidentData) {
  try {
    // Add workflow-specific fields
    const workflowIncident = {
      ...incidentData,
      status: 'pending_analysis',  // This triggers the orchestrator
      workflow_stage: 'created',
      recovery_attempted: false,
      processed_at: null
    }
    
    // Save to Supabase
    const { data, error } = await supabase
      .from('incidents')
      .insert([workflowIncident])
      .select()
      .single()
    
    if (error) throw error
    
    console.log('[Backend Client] Incident created for orchestrator:', data.id)
    
    return {
      success: true,
      incident: data
    }
    
  } catch (error) {
    console.error('[Backend Client] Failed to trigger workflow:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/* ─────────────────────────────────────────────
   SUBSCRIBE TO WORKFLOW UPDATES
   Watch for workflow stage changes on an incident
───────────────────────────────────────────── */
export function subscribeToWorkflowUpdates(incidentId, callback) {
  const channel = supabase
    .channel(`workflow-${incidentId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'incidents',
        filter: `id=eq.${incidentId}`
      },
      (payload) => {
        const updated = payload.new
        callback({
          stage: updated.workflow_stage,
          status: updated.status,
          recoveryAttempted: updated.recovery_attempted,
          recoveryAction: updated.recovery_action,
          rootCause: updated.root_cause,
          suggestedFix: updated.suggested_fix,
          confidence: updated.confidence,
          processedAt: updated.processed_at
        })
      }
    )
    .subscribe()
  
  return channel
}

/* ─────────────────────────────────────────────
   UNSUBSCRIBE FROM WORKFLOW UPDATES
───────────────────────────────────────────── */
export function unsubscribeFromWorkflow(channel) {
  if (channel) {
    supabase.removeChannel(channel)
  }
}

/* ─────────────────────────────────────────────
   GET ORCHESTRATOR STATISTICS
   Get statistics about orchestrator activity
───────────────────────────────────────────── */
export async function getOrchestratorStats() {
  try {
    const incidents = await fetchIncidents()
    
    const stats = {
      total: incidents.length,
      pending: incidents.filter(i => i.status === 'pending_analysis').length,
      processing: incidents.filter(i => 
        i.workflow_stage && 
        !['created', 'completed', 'error'].includes(i.workflow_stage)
      ).length,
      completed: incidents.filter(i => i.workflow_stage === 'completed').length,
      resolved: incidents.filter(i => i.status === 'resolved').length,
      analyzed: incidents.filter(i => i.status === 'analyzed').length,
      withRecovery: incidents.filter(i => i.recovery_attempted).length
    }
    
    return {
      success: true,
      stats
    }
    
  } catch (error) {
    console.error('[Backend Client] Failed to get stats:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/* ─────────────────────────────────────────────
   CONSOLE LOGGING HELPERS
───────────────────────────────────────────── */
export function logWorkflowEvent(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString()
  const prefix = '[Workflow]'
  
  switch (type) {
    case 'success':
      console.log(`%c${prefix} ${timestamp} ✅ ${message}`, 'color: #4caf50')
      break
    case 'error':
      console.error(`%c${prefix} ${timestamp} ❌ ${message}`, 'color: #f44336')
      break
    case 'warn':
      console.warn(`%c${prefix} ${timestamp} ⚠️  ${message}`, 'color: #ff9800')
      break
    default:
      console.log(`%c${prefix} ${timestamp} ℹ️  ${message}`, 'color: #2196f3')
  }
}

// Export for use in app.js
export default {
  checkOrchestratorHealth,
  getWorkflowStatus,
  getWorkflowStageInfo,
  triggerRealWorkflow,
  subscribeToWorkflowUpdates,
  unsubscribeFromWorkflow,
  getOrchestratorStats,
  logWorkflowEvent,
  WORKFLOW_STAGES
}

// Made with Bob
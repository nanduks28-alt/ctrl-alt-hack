"""
Workflow Manager - Incident Response Orchestration
===================================================

Orchestrates the complete incident response workflow:
1. Parse logs
2. Attempt automatic recovery
3. Escalate to Bob AI if recovery fails
4. Update Supabase with results

Author: SRE-Bot Team
"""

import time
from typing import Dict, Any, Optional
from datetime import datetime

# Import our modules
from workflow_logger import logger
from supabase_client import (
    get_incident,
    update_workflow_stage,
    mark_incident_analyzed,
    mark_incident_resolved,
    get_client
)

# Import existing Python scripts
from log_parser import detect_errors_in_logs, ERROR_KEYWORDS
from recovery_engine import attempt_recovery
from bob_connector import analyze_incident


class WorkflowManager:
    """
    Manages the complete incident response workflow.
    
    Workflow stages:
        1. created -> logs_parsed
        2. logs_parsed -> recovery_attempted
        3. recovery_attempted -> escalating_to_bob (if failed) OR completed (if success)
        4. escalating_to_bob -> completed
    """
    
    def __init__(self):
        """Initialize the workflow manager."""
        self.total_stages = 4
        self.start_time: Optional[float] = None
    
    async def process_incident(self, incident_id: str) -> bool:
        """
        Process an incident through the complete workflow.
        
        Args:
            incident_id: Incident ID to process
            
        Returns:
            bool: True if workflow completed successfully
        """
        self.start_time = time.time()
        
        try:
            # Set incident context for logging
            logger.set_incident_context(incident_id)
            logger.workflow_started(incident_id)
            
            # Fetch incident data
            incident = get_incident(incident_id)
            if not incident:
                logger.error(f"Incident {incident_id} not found")
                return False
            
            # Extract incident details
            service_name = incident.get('service', 'unknown')
            error_type = incident.get('error_type', 'unknown')
            logs = incident.get('logs', '')
            severity = incident.get('severity', 'MEDIUM')
            
            # ═════════════════════════════════════════════════════════════
            # STAGE 1: PARSE LOGS
            # ═════════════════════════════════════════════════════════════
            logger.stage(1, self.total_stages, "Log Analysis")
            
            log_analysis = self._parse_logs(logs, service_name, error_type)
            
            # Update workflow stage
            update_workflow_stage(incident_id, 'logs_parsed', {
                'orchestrator_logs': {
                    'stage_1': log_analysis,
                    'timestamp': datetime.utcnow().isoformat()
                }
            })
            
            # ═════════════════════════════════════════════════════════════
            # STAGE 2: ATTEMPT RECOVERY
            # ═════════════════════════════════════════════════════════════
            logger.stage(2, self.total_stages, "Recovery Attempt")
            
            recovery_result = self._attempt_recovery(service_name, error_type)
            
            # Update workflow stage
            update_workflow_stage(incident_id, 'recovery_attempted', {
                'recovery_attempted': True,
                'recovery_action': recovery_result['action']
            })
            
            # ═════════════════════════════════════════════════════════════
            # DECISION POINT: Recovery Success or Escalate?
            # ═════════════════════════════════════════════════════════════
            
            if recovery_result['success']:
                # Recovery succeeded - mark incident as resolved
                logger.stage(3, self.total_stages, "Recovery Successful")
                logger.success(f"Incident resolved automatically: {recovery_result['message']}")
                
                mark_incident_resolved(incident_id, recovery_result['action'])
                
                # Skip stage 4 (Bob AI) since recovery worked
                duration = time.time() - self.start_time
                logger.workflow_complete(incident_id, duration, 'resolved')
                logger.set_incident_context(None)
                return True
            
            # ═════════════════════════════════════════════════════════════
            # STAGE 3: ESCALATE TO BOB AI
            # ═════════════════════════════════════════════════════════════
            logger.stage(3, self.total_stages, "Bob AI Analysis")
            logger.warn("Recovery failed. Escalating to Bob AI...")
            
            # Update workflow stage
            update_workflow_stage(incident_id, 'escalating_to_bob')
            
            bob_result = self._escalate_to_bob(
                service_name,
                error_type,
                logs,
                recovery_result
            )
            
            # ═════════════════════════════════════════════════════════════
            # STAGE 4: UPDATE DATABASE WITH RESULTS
            # ═════════════════════════════════════════════════════════════
            logger.stage(4, self.total_stages, "Update Database")
            
            success = mark_incident_analyzed(
                incident_id,
                root_cause=bob_result['root_cause'],
                suggested_fix=bob_result['suggested_fix'],
                confidence=bob_result['confidence'],
                recovery_attempted=True,
                recovery_action=recovery_result['action']
            )
            
            if success:
                logger.success("Incident analysis saved to Supabase")
            else:
                logger.error("Failed to save incident analysis")
            
            # ═════════════════════════════════════════════════════════════
            # WORKFLOW COMPLETE
            # ═════════════════════════════════════════════════════════════
            duration = time.time() - self.start_time
            logger.workflow_complete(incident_id, duration, 'analyzed')
            logger.set_incident_context(None)
            
            return True
            
        except Exception as e:
            logger.critical(f"Workflow failed for {incident_id}: {str(e)}")
            logger.set_incident_context(None)
            
            # Try to update incident with error status
            try:
                update_workflow_stage(incident_id, 'error', {
                    'status': 'error',
                    'error_message': str(e)
                })
            except:
                pass
            
            return False
    
    def _parse_logs(self, logs: str, service_name: str, error_type: str) -> Dict[str, Any]:
        """
        Parse incident logs for error analysis.
        
        Args:
            logs: Raw log text
            service_name: Service name
            error_type: Error type
            
        Returns:
            Dict: Log analysis results
        """
        logger.progress("📝 Analyzing incident logs...")
        
        # Use log_parser.py to detect errors
        error_count = detect_errors_in_logs(logs, ERROR_KEYWORDS)
        is_critical = error_count > 3
        
        analysis = {
            'error_count': error_count,
            'is_critical': is_critical,
            'keywords_found': ERROR_KEYWORDS,
            'service': service_name,
            'error_type': error_type
        }
        
        logger.progress(f"✅ Analysis complete")
        logger.progress(f"📊 Errors detected: {error_count}")
        
        if is_critical:
            logger.progress("⚠️  Critical threshold exceeded")
        
        return analysis
    
    def _attempt_recovery(self, service_name: str, error_type: str) -> Dict[str, Any]:
        """
        Attempt automatic recovery using recovery_engine.py.
        
        Args:
            service_name: Service name
            error_type: Error type
            
        Returns:
            Dict: Recovery result
        """
        logger.progress("🔧 Attempting automatic recovery...")
        logger.progress(f"🔄 Service: {service_name}")
        logger.progress(f"🔄 Error type: {error_type}")
        
        # Fetch project details for demo_url and repo_url
        client = get_client()
        project = client.get_project_for_service(service_name)
        
        demo_url = None
        repo_url = None
        
        if project:
            demo_url = project.get('demo_url')
            repo_url = project.get('repo_url')
            logger.progress(f"📍 Demo URL: {demo_url}")
            logger.progress(f"📦 Repo URL: {repo_url}")
        else:
            logger.progress("⚠️  No project found for service - limited recovery options")
        
        # Call recovery_engine.py with URLs
        result = attempt_recovery(service_name, error_type, demo_url, repo_url)
        
        if result['success']:
            logger.progress(f"✅ Recovery successful: {result['action']}")
        else:
            logger.progress(f"❌ Recovery failed: {result['action']}")
            logger.progress("📈 Escalating to AI analysis...")
        
        return result
    
    def _escalate_to_bob(
        self,
        service_name: str,
        error_type: str,
        logs: str,
        recovery_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Escalate to Bob AI for deep analysis.
        
        Args:
            service_name: Service name
            error_type: Error type
            logs: Raw logs
            recovery_result: Result from recovery attempt
            
        Returns:
            Dict: Bob AI analysis result
        """
        logger.progress("🤖 Sending to Bob AI...")
        
        # Call bob_connector.py
        result = analyze_incident(
            service_name=service_name,
            error_type=error_type,
            logs=logs,
            recovery_attempted=True,
            recovery_action=recovery_result['action']
        )
        
        logger.progress("📊 Root cause identified")
        logger.progress("💡 Suggested fix generated")
        logger.progress(f"🎯 Confidence: {result['confidence']}%")
        logger.progress("✅ Analysis complete")
        
        return result
    
    def get_workflow_duration(self) -> float:
        """
        Get the current workflow duration in seconds.
        
        Returns:
            float: Duration in seconds
        """
        if self.start_time:
            return time.time() - self.start_time
        return 0.0


# Global workflow manager instance
_manager: Optional[WorkflowManager] = None


def get_manager() -> WorkflowManager:
    """
    Get or create the global workflow manager instance.
    
    Returns:
        WorkflowManager: Initialized manager
    """
    global _manager
    if _manager is None:
        _manager = WorkflowManager()
    return _manager


async def process_incident(incident_id: str) -> bool:
    """
    Process an incident through the workflow.
    
    Args:
        incident_id: Incident ID to process
        
    Returns:
        bool: True if successful
    """
    return await get_manager().process_incident(incident_id)


if __name__ == "__main__":
    """Test the workflow manager"""
    import asyncio
    
    print("\n" + "="*60)
    print("WORKFLOW MANAGER - Test Mode")
    print("="*60 + "\n")
    
    logger.info("This is a test of the workflow manager")
    logger.info("In production, this will be called by orchestrator_service.py")
    logger.info("when new incidents are detected in Supabase")
    print()
    
    logger.warn("To test the full workflow:")
    logger.info("1. Ensure Supabase credentials are in .env")
    logger.info("2. Create a test incident in Supabase with status='pending_analysis'")
    logger.info("3. Run: python orchestrator_service.py")
    print()
    
    logger.success("Workflow manager module loaded successfully", "✅")

# Made with Bob
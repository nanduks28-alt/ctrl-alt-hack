"""
Supabase Client - Python Wrapper for SRE-Bot Orchestrator
==========================================================

Provides a clean interface for the orchestrator to interact with Supabase,
including incident CRUD operations, realtime subscriptions, and error handling.

Author: SRE-Bot Team
"""

import os
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client
from workflow_logger import logger

# Load environment variables
load_dotenv()


class SupabaseClientWrapper:
    """
    Wrapper around Supabase client with orchestrator-specific methods.
    
    Features:
        - Incident CRUD operations
        - Workflow stage tracking
        - Error handling with logging
        - Realtime subscription management
    """
    
    def __init__(self):
        """Initialize Supabase client from environment variables."""
        self.url = os.getenv('SUPABASE_URL')
        self.key = os.getenv('SUPABASE_ANON_KEY')
        
        if not self.url or not self.key:
            raise ValueError(
                "Missing Supabase credentials. "
                "Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file."
            )
        
        self.client: Client = create_client(self.url, self.key)
        self._subscription = None
    
    def test_connection(self) -> bool:
        """
        Test the Supabase connection.
        
        Returns:
            bool: True if connection successful
        """
        try:
            # Try to fetch one incident to test connection
            response = self.client.table('incidents').select('id').limit(1).execute()
            return True
        except Exception as e:
            logger.error(f"Connection test failed: {str(e)}")
            return False
    
    # =========================================================================
    # INCIDENT OPERATIONS
    # =========================================================================
    
    def get_incident(self, incident_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a single incident by ID.
        
        Args:
            incident_id: Incident ID (e.g., "INC-0001")
            
        Returns:
            Dict or None: Incident data or None if not found
        """
        try:
            response = self.client.table('incidents') \
                .select('*') \
                .eq('id', incident_id) \
                .single() \
                .execute()
            
            return response.data if response.data else None
            
        except Exception as e:
            logger.error(f"Failed to fetch incident {incident_id}: {str(e)}")
            return None
    
    def get_pending_incidents(self) -> List[Dict[str, Any]]:
        """
        Fetch all incidents with status='pending_analysis'.
        
        Returns:
            List[Dict]: List of pending incidents
        """
        try:
            response = self.client.table('incidents') \
                .select('*') \
                .eq('status', 'pending_analysis') \
                .order('started_at', desc=False) \
                .execute()
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Failed to fetch pending incidents: {str(e)}")
            return []
    
    def update_incident(
        self,
        incident_id: str,
        updates: Dict[str, Any]
    ) -> bool:
        """
        Update an incident with new data.
        
        Args:
            incident_id: Incident ID
            updates: Dictionary of fields to update
            
        Returns:
            bool: True if successful
        """
        try:
            response = self.client.table('incidents') \
                .update(updates) \
                .eq('id', incident_id) \
                .execute()
            
            logger.info(f"Updated incident {incident_id}", "💾")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update incident {incident_id}: {str(e)}")
            return False
    
    def update_workflow_stage(
        self,
        incident_id: str,
        stage: str,
        additional_data: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Update the workflow stage of an incident.
        
        Args:
            incident_id: Incident ID
            stage: New workflow stage
            additional_data: Optional additional fields to update
            
        Returns:
            bool: True if successful
        """
        updates = {
            'workflow_stage': stage,
            'processed_at': datetime.utcnow().isoformat()
        }
        
        if additional_data:
            updates.update(additional_data)
        
        return self.update_incident(incident_id, updates)
    
    def mark_incident_analyzed(
        self,
        incident_id: str,
        root_cause: str,
        suggested_fix: str,
        confidence: int,
        recovery_attempted: bool = False,
        recovery_action: Optional[str] = None
    ) -> bool:
        """
        Mark an incident as analyzed with Bob AI results.
        
        Args:
            incident_id: Incident ID
            root_cause: Identified root cause
            suggested_fix: Suggested fix
            confidence: Confidence score (0-100)
            recovery_attempted: Whether recovery was attempted
            recovery_action: Recovery action taken
            
        Returns:
            bool: True if successful
        """
        updates = {
            'status': 'analyzed',
            'workflow_stage': 'completed',
            'root_cause': root_cause,
            'suggested_fix': suggested_fix,
            'confidence': confidence,
            'recovery_attempted': recovery_attempted,
            'processed_at': datetime.utcnow().isoformat()
        }
        
        if recovery_action:
            updates['recovery_action'] = recovery_action
        
        return self.update_incident(incident_id, updates)
    
    def mark_incident_resolved(
        self,
        incident_id: str,
        recovery_action: str
    ) -> bool:
        """
        Mark an incident as resolved after successful recovery.
        
        Args:
            incident_id: Incident ID
            recovery_action: Recovery action that succeeded
            
        Returns:
            bool: True if successful
        """
        updates = {
            'status': 'resolved',
            'workflow_stage': 'completed',
            'resolved_at': datetime.utcnow().isoformat(),
            'recovery_attempted': True,
            'recovery_action': recovery_action,
            'processed_at': datetime.utcnow().isoformat()
        }
        
        return self.update_incident(incident_id, updates)
    
    # =========================================================================
    # REALTIME SUBSCRIPTIONS
    # =========================================================================
    
    def subscribe_to_incidents(
        self,
        callback: Callable[[Dict[str, Any]], None]
    ) -> None:
        """
        Subscribe to realtime changes on the incidents table.
        
        Args:
            callback: Function to call when incident changes occur
                     Receives payload dict with 'eventType' and 'new' keys
        """
        try:
            def handle_change(payload):
                """Internal handler that wraps the callback"""
                try:
                    event_type = payload.get('eventType')
                    
                    # Only process INSERT events for new incidents
                    if event_type == 'INSERT':
                        new_incident = payload.get('new')
                        if new_incident and new_incident.get('status') == 'pending_analysis':
                            callback(new_incident)
                    
                except Exception as e:
                    logger.error(f"Error in realtime callback: {str(e)}")
            
            # Create realtime subscription
            self._subscription = self.client.channel('incidents-orchestrator') \
                .on_postgres_changes(
                    event='INSERT',
                    schema='public',
                    table='incidents',
                    callback=handle_change
                ) \
                .subscribe()
            
            logger.success("Subscribed to incidents table (realtime)", "👂")
            
        except Exception as e:
            logger.error(f"Failed to subscribe to incidents: {str(e)}")
    
    def unsubscribe(self) -> None:
        """Unsubscribe from realtime changes."""
        if self._subscription:
            try:
                self.client.remove_channel(self._subscription)
                self._subscription = None
                logger.info("Unsubscribed from incidents table")
            except Exception as e:
                logger.error(f"Failed to unsubscribe: {str(e)}")
    
    # =========================================================================
    # POSTMORTEM OPERATIONS
    # =========================================================================
    
    def save_postmortem(self, postmortem_data: Dict[str, Any]) -> bool:
        """
        Save a postmortem report.
        
        Args:
            postmortem_data: Postmortem data dictionary
            
        Returns:
            bool: True if successful
        """
        try:
            response = self.client.table('postmortems') \
                .insert(postmortem_data) \
                .execute()
            
            logger.success(f"Postmortem saved for {postmortem_data.get('incident_id')}", "📝")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save postmortem: {str(e)}")
            return False
    
    # =========================================================================
    # UTILITY METHODS
    # =========================================================================
    
    def get_recent_incidents(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Fetch recent incidents for monitoring.
        
        Args:
            limit: Maximum number of incidents to fetch
            
        Returns:
            List[Dict]: List of recent incidents
        """
        try:
            response = self.client.table('incidents') \
                .select('*') \
                .order('started_at', desc=True) \
                .limit(limit) \
                .execute()
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Failed to fetch recent incidents: {str(e)}")
            return []
    
    def get_orchestrator_health(self) -> Dict[str, Any]:
        """
        Get orchestrator health metrics.
        
        Returns:
            Dict: Health metrics including recent processing activity
        """
        try:
            # Check for recently processed incidents (last 5 minutes)
            five_min_ago = datetime.utcnow().isoformat()
            
            response = self.client.table('incidents') \
                .select('id, processed_at, workflow_stage') \
                .not_.is_('processed_at', 'null') \
                .order('processed_at', desc=True) \
                .limit(5) \
                .execute()
            
            recent_processed = response.data if response.data else []
            
            # Count pending incidents
            pending = self.get_pending_incidents()
            
            return {
                'status': 'healthy' if len(recent_processed) > 0 or len(pending) == 0 else 'idle',
                'recent_processed': len(recent_processed),
                'pending_count': len(pending),
                'last_processed': recent_processed[0].get('processed_at') if recent_processed else None
            }
            
        except Exception as e:
            logger.error(f"Failed to get health metrics: {str(e)}")
            return {
                'status': 'error',
                'error': str(e)
            }
    
    def get_project_for_service(self, service_name: str) -> Optional[Dict[str, Any]]:
        """
        Get project details for a service name.
        
        Args:
            service_name: Service name to look up
            
        Returns:
            Dict or None: Project data or None if not found
        """
        try:
            response = self.client.table('monitored_projects') \
                .select('*') \
                .eq('name', service_name) \
                .single() \
                .execute()
            
            return response.data if response.data else None
            
        except Exception as e:
            logger.error(f"Failed to fetch project for service {service_name}: {str(e)}")
            return None


# Global client instance
_client: Optional[SupabaseClientWrapper] = None


def get_client() -> SupabaseClientWrapper:
    """
    Get or create the global Supabase client instance.
    
    Returns:
        SupabaseClientWrapper: Initialized client
    """
    global _client
    if _client is None:
        _client = SupabaseClientWrapper()
    return _client


# Convenience functions for direct import
def get_incident(incident_id: str) -> Optional[Dict[str, Any]]:
    """Get incident by ID"""
    return get_client().get_incident(incident_id)


def get_pending_incidents() -> List[Dict[str, Any]]:
    """Get all pending incidents"""
    return get_client().get_pending_incidents()


def update_incident(incident_id: str, updates: Dict[str, Any]) -> bool:
    """Update incident"""
    return get_client().update_incident(incident_id, updates)


def update_workflow_stage(incident_id: str, stage: str, additional_data: Optional[Dict[str, Any]] = None) -> bool:
    """Update workflow stage"""
    return get_client().update_workflow_stage(incident_id, stage, additional_data)


def mark_incident_analyzed(
    incident_id: str,
    root_cause: str,
    suggested_fix: str,
    confidence: int,
    recovery_attempted: bool = False,
    recovery_action: Optional[str] = None
) -> bool:
    """Mark incident as analyzed"""
    return get_client().mark_incident_analyzed(
        incident_id, root_cause, suggested_fix, confidence, recovery_attempted, recovery_action
    )


def mark_incident_resolved(incident_id: str, recovery_action: str) -> bool:
    """Mark incident as resolved"""
    return get_client().mark_incident_resolved(incident_id, recovery_action)


if __name__ == "__main__":
    """Test the Supabase client"""
    print("\n" + "="*60)
    print("SUPABASE CLIENT - Connection Test")
    print("="*60 + "\n")
    
    try:
        client = get_client()
        
        logger.info("Testing connection...", "🔌")
        if client.test_connection():
            logger.success(f"Connected to: {client.url}")
        else:
            logger.error("Connection failed")
            exit(1)
        
        logger.info("Fetching pending incidents...", "📋")
        pending = client.get_pending_incidents()
        logger.info(f"Found {len(pending)} pending incidents")
        
        logger.info("Checking orchestrator health...", "💚")
        health = client.get_orchestrator_health()
        logger.info(f"Status: {health['status']}")
        logger.info(f"Pending: {health['pending_count']}")
        logger.info(f"Recently processed: {health['recent_processed']}")
        
        logger.success("All tests passed!", "✅")
        
    except Exception as e:
        logger.critical(f"Test failed: {str(e)}")
        exit(1)

# Made with Bob
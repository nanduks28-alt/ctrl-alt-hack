"""
Orchestrator Service - Main SRE-Bot Incident Response Service
==============================================================

This service continuously monitors Supabase for new incidents and
orchestrates the complete incident response workflow.

Features:
    - Watches Supabase for incidents with status='pending_analysis'
    - Triggers workflow manager for each new incident
    - Handles errors gracefully
    - Provides health monitoring
    - Beautiful console output

Usage:
    python orchestrator_service.py

Author: SRE-Bot Team
"""

import asyncio
import signal
import sys
from typing import Dict, Any, Optional
from datetime import datetime

# Import our modules
from workflow_logger import logger
from supabase_client import get_client, SupabaseClientWrapper
from workflow_manager import process_incident
from monitor_agent import MonitorAgent


class OrchestratorService:
    """
    Main orchestrator service that watches Supabase and processes incidents.
    
    Architecture:
        1. Connects to Supabase
        2. Subscribes to realtime incident changes
        3. Detects new incidents with status='pending_analysis'
        4. Triggers workflow_manager to process each incident
        5. Handles graceful shutdown
    """
    
    def __init__(self):
        """Initialize the orchestrator service."""
        self.running = False
        self.client: Optional[SupabaseClientWrapper] = None
        self.processed_incidents = set()  # Track processed incidents to avoid duplicates
        self.start_time: Optional[datetime] = None
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        logger.warn("\nShutdown signal received. Stopping orchestrator...", "🛑")
        self.running = False
    
    async def start(self):
        """
        Start the orchestrator service.
        
        This is the main entry point that:
        1. Displays startup banner
        2. Connects to Supabase
        3. Processes any existing pending incidents
        4. Subscribes to realtime updates
        5. Keeps running until shutdown
        """
        self.running = True
        self.start_time = datetime.utcnow()
        
        # Display startup banner
        self._display_banner()
        
        try:
            # Connect to Supabase
            logger.info("Connecting to Supabase...", "🔌")
            self.client = get_client()
            
            if not self.client.test_connection():
                logger.critical("Failed to connect to Supabase. Check your .env file.")
                return
            
            logger.success(f"Connected: {self.client.url}")
            
            # Process any existing pending incidents
            await self._process_existing_incidents()
            
            # Subscribe to realtime updates
            logger.info("Setting up realtime subscription...", "📡")
            self.client.subscribe_to_incidents(self._handle_new_incident)
            
            # Display ready message
            logger.success("Orchestrator ready", "💚")
            logger.info("Listening for incidents...", "👂")
            logger.separator()
            print()
            
            # Keep running until shutdown signal
            await self._run_loop()
            
        except KeyboardInterrupt:
            logger.warn("Keyboard interrupt received", "⌨️")
        except Exception as e:
            logger.critical(f"Fatal error: {str(e)}")
        finally:
            await self._shutdown()
    
    async def _process_existing_incidents(self):
        """
        Process any incidents that are already pending in Supabase.
        
        This handles the case where incidents were created while the
        orchestrator was offline.
        """
        logger.info("Checking for existing pending incidents...", "🔍")
        
        if not self.client:
            return
        
        pending = self.client.get_pending_incidents()
        
        if not pending:
            logger.info("No pending incidents found")
            return
        
        logger.warn(f"Found {len(pending)} pending incident(s). Processing...", "📋")
        
        for incident in pending:
            incident_id = incident.get('id')
            if incident_id and incident_id not in self.processed_incidents:
                await self._process_incident_safe(incident)
    
    def _handle_new_incident(self, incident: Dict[str, Any]):
        """
        Handle a new incident detected via realtime subscription.
        
        This is called by the Supabase realtime callback when a new
        incident is inserted with status='pending_analysis'.
        
        Args:
            incident: Incident data from Supabase
        """
        incident_id = incident.get('id')
        
        # Validate incident_id
        if not incident_id:
            logger.error("Received incident without ID")
            return
        
        # Avoid processing the same incident twice
        if incident_id in self.processed_incidents:
            return
        
        # Log incident detection
        service = incident.get('service', 'unknown')
        error_type = incident.get('error_type', 'unknown')
        severity = incident.get('severity', 'MEDIUM')
        
        logger.incident_detected(incident_id, service, error_type, severity)
        
        # Process incident asynchronously
        asyncio.create_task(self._process_incident_safe(incident))
    
    async def _process_incident_safe(self, incident: Dict[str, Any]):
        """
        Safely process an incident with error handling.
        
        Args:
            incident: Incident data from Supabase
        """
        incident_id = incident.get('id')
        
        # Validate incident_id
        if not incident_id:
            logger.error("Cannot process incident without ID")
            return
        
        # Mark as processed to avoid duplicates
        self.processed_incidents.add(incident_id)
        
        try:
            # Process through workflow manager
            success = await process_incident(incident_id)
            
            if success:
                logger.info(f"Incident {incident_id} processed successfully", "✅")
            else:
                logger.error(f"Incident {incident_id} processing failed")
            
        except Exception as e:
            logger.error(f"Error processing incident {incident_id}: {str(e)}")
        
        finally:
            # After processing, return to listening state
            logger.info("Listening for incidents...", "👂")
    
    async def _run_loop(self):
        """
        Main run loop that keeps the service alive.
        
        This loop runs until self.running is set to False by a shutdown signal.
        It also periodically displays health status and updates heartbeat.
        """
        health_check_interval = 300  # 5 minutes
        heartbeat_interval = 60  # 1 minute
        last_health_check = datetime.utcnow()
        last_heartbeat = datetime.utcnow()
        
        while self.running:
            # Sleep for a short interval
            await asyncio.sleep(1)
            
            now = datetime.utcnow()
            
            # Periodic heartbeat update
            if (now - last_heartbeat).total_seconds() >= heartbeat_interval:
                try:
                    self.client.client.table('orchestrator_heartbeat').upsert({
                        'id': 'singleton',
                        'last_ping': now.isoformat(),
                        'version': '1.0.0'
                    }).execute()
                except Exception as e:
                    logger.error(f"Failed to update heartbeat: {str(e)}")
                last_heartbeat = now
            
            # Periodic health check
            if (now - last_health_check).total_seconds() >= health_check_interval:
                self._display_health_status()
                last_health_check = now
    
    async def _shutdown(self):
        """Gracefully shutdown the orchestrator service."""
        logger.info("Shutting down orchestrator...", "🛑")
        
        if self.client:
            logger.info("Unsubscribing from Supabase...")
            self.client.unsubscribe()
        
        # Display final statistics
        self._display_shutdown_stats()
        
        logger.success("Orchestrator stopped", "👋")
    
    def _display_banner(self):
        """Display the startup banner."""
        logger.header(
            "🤖 SRE-Bot Orchestrator Service v1.0.0",
            "Intelligent Incident Response Automation"
        )
    
    def _display_health_status(self):
        """Display current health status."""
        if not self.client or not self.start_time:
            return
        
        health = self.client.get_orchestrator_health()
        uptime = (datetime.utcnow() - self.start_time).total_seconds() / 60
        
        logger.separator()
        logger.info("HEALTH CHECK", "💚")
        logger.info(f"  Status: {health['status']}")
        logger.info(f"  Uptime: {uptime:.1f} minutes")
        logger.info(f"  Processed: {len(self.processed_incidents)} incidents")
        logger.info(f"  Pending: {health['pending_count']} incidents")
        logger.separator()
        print()
    
    def _display_shutdown_stats(self):
        """Display statistics before shutdown."""
        if not self.start_time:
            return
        
        uptime = (datetime.utcnow() - self.start_time).total_seconds() / 60
        
        logger.separator()
        logger.info("SESSION STATISTICS", "📊")
        logger.info(f"  Total uptime: {uptime:.1f} minutes")
        logger.info(f"  Incidents processed: {len(self.processed_incidents)}")
        logger.separator()


# Global service instance
_service: Optional[OrchestratorService] = None


def get_service() -> OrchestratorService:
    """
    Get or create the global orchestrator service instance.
    
    Returns:
        OrchestratorService: Initialized service
    """
    global _service
    if _service is None:
        _service = OrchestratorService()
    return _service


async def main():
    """
    Main entry point for the orchestrator service.
    
    This function is called when the script is run directly.
    Runs both the orchestrator and monitor agent concurrently.
    """
    orchestrator = get_service()
    monitor = MonitorAgent()
    
    # Run both services concurrently
    await asyncio.gather(
        orchestrator.start(),
        monitor.start()
    )


if __name__ == "__main__":
    """
    Run the orchestrator service.
    
    Usage:
        python orchestrator_service.py
    
    Environment Variables Required:
        SUPABASE_URL - Your Supabase project URL
        SUPABASE_ANON_KEY - Your Supabase anonymous key
    
    The service will:
        1. Connect to Supabase
        2. Process any existing pending incidents
        3. Subscribe to realtime updates
        4. Process new incidents as they arrive
        5. Run until Ctrl+C or SIGTERM
    """
    try:
        # Run the async main function
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n")
        logger.info("Orchestrator stopped by user", "👋")
    except Exception as e:
        logger.critical(f"Fatal error: {str(e)}")
        sys.exit(1)

# Made with Bob
"""
Monitor Agent - Real-Time Project Health Monitoring
====================================================
Polls all registered projects on a configurable interval.
Detects outages and automatically creates incidents in Supabase.
Runs alongside orchestrator_service.py.

Author: SRE-Bot Team
"""

import asyncio
import os
import time
from typing import Dict, List, Optional, Any
from datetime import datetime
import aiohttp
from dotenv import load_dotenv

from workflow_logger import logger
from supabase_client import get_client, SupabaseClientWrapper

# Load environment variables
load_dotenv()


class MonitorAgent:
    """
    Real-time monitoring agent for registered projects.
    
    Features:
        - Polls projects at configurable intervals
        - Detects HTTP errors, timeouts, and slow responses
        - Creates incidents automatically when projects go down
        - Resolves incidents when projects recover
        - Subscribes to realtime updates for new projects
        - Fetches GitHub commits for incident context
    """
    
    def __init__(self):
        """Initialize the monitor agent."""
        self.client: SupabaseClientWrapper = get_client()
        self.down_projects: Dict[str, str] = {}  # project_id -> incident_id
        self.monitored: List[Dict] = []
        self.running = False
        self.check_interval = int(os.getenv('MONITOR_INTERVAL_SECONDS', '30'))
        self.timeout = int(os.getenv('MONITOR_TIMEOUT_SECONDS', '10'))
        self._subscription = None
    
    async def start(self):
        """
        Start the monitoring agent.
        
        This is the main entry point that:
        1. Displays startup banner
        2. Loads projects from database
        3. Subscribes to realtime updates
        4. Starts monitoring loop
        """
        self.running = True
        
        logger.header(
            "🔍 Monitor Agent v1.0.0",
            "Real-Time Project Health Monitoring"
        )
        
        logger.info(f"Check interval: {self.check_interval}s", "⏱️")
        logger.info(f"Request timeout: {self.timeout}s", "⏱️")
        logger.separator()
        print()
        
        try:
            # Load projects from database
            await self._load_projects()
            
            # Subscribe to realtime updates
            self._subscribe_to_projects()
            
            logger.success("Monitor agent ready", "💚")
            logger.info(f"Monitoring {len(self.monitored)} project(s)...", "👀")
            logger.separator()
            print()
            
            # Start monitoring loop
            await self._run_monitoring_loop()
            
        except Exception as e:
            logger.critical(f"Monitor agent error: {str(e)}")
        finally:
            await self._shutdown()
    
    async def _load_projects(self):
        """Load all active projects from monitored_projects table."""
        logger.info("Loading projects from database...", "📂")
        
        try:
            response = self.client.client.table('monitored_projects') \
                .select('*') \
                .eq('is_active', True) \
                .execute()
            
            self.monitored = response.data if response.data else []
            logger.success(f"Loaded {len(self.monitored)} project(s)", "✅")
            
            for project in self.monitored:
                logger.info(f"  • {project['name']} → {project['demo_url']}")
        
        except Exception as e:
            logger.error(f"Failed to load projects: {str(e)}")
            self.monitored = []
    
    def _subscribe_to_projects(self):
        """Subscribe to realtime changes on monitored_projects table."""
        try:
            def handle_change(payload):
                """Handle realtime project changes"""
                try:
                    event_type = payload.get('eventType')
                    
                    if event_type == 'INSERT':
                        new_project = payload.get('new')
                        if new_project and new_project.get('is_active'):
                            self.monitored.append(new_project)
                            logger.info(f"New project added: {new_project['name']}", "➕")
                    
                    elif event_type == 'UPDATE':
                        updated = payload.get('new')
                        if updated:
                            # Update existing project in list
                            for i, proj in enumerate(self.monitored):
                                if proj['id'] == updated['id']:
                                    self.monitored[i] = updated
                                    break
                    
                    elif event_type == 'DELETE':
                        old = payload.get('old')
                        if old:
                            self.monitored = [p for p in self.monitored if p['id'] != old['id']]
                            logger.info(f"Project removed: {old.get('name', 'unknown')}", "➖")
                
                except Exception as e:
                    logger.error(f"Error in realtime callback: {str(e)}")
            
            self._subscription = self.client.client.channel('monitor-projects') \
                .on_postgres_changes(
                    event='*',
                    schema='public',
                    table='monitored_projects',
                    callback=handle_change
                ) \
                .subscribe()
            
            logger.success("Subscribed to project updates (realtime)", "👂")
        
        except Exception as e:
            logger.error(f"Failed to subscribe to projects: {str(e)}")
    
    async def _run_monitoring_loop(self):
        """Main monitoring loop that checks all projects periodically."""
        while self.running:
            if not self.monitored:
                await asyncio.sleep(self.check_interval)
                continue
            
            # Check all projects concurrently
            tasks = [self._check_project(project) for project in self.monitored]
            await asyncio.gather(*tasks, return_exceptions=True)
            
            # Wait for next check interval
            await asyncio.sleep(self.check_interval)
    
    async def _check_project(self, project: Dict):
        """
        Check a single project's health.
        
        Args:
            project: Project data from monitored_projects table
        """
        project_id = project['id']
        project_name = project['name']
        demo_url = project['demo_url']
        
        try:
            # Perform HTTP check
            check_result = await self._check_url(demo_url)
            
            # Update last_checked timestamp
            self.client.client.table('monitored_projects') \
                .update({
                    'last_checked': datetime.utcnow().isoformat(),
                    'last_status': 'down' if not check_result['ok'] else 'up'
                }) \
                .eq('id', project_id) \
                .execute()
            
            # Handle state transitions
            is_currently_down = project_id in self.down_projects
            
            if not check_result['ok'] and not is_currently_down:
                # Project just went DOWN - create incident
                logger.warn(f"Project DOWN: {project_name}", "🔴")
                await self._create_incident(project, check_result)
            
            elif check_result['ok'] and is_currently_down:
                # Project recovered - resolve incident
                logger.success(f"Project UP: {project_name}", "🟢")
                await self._resolve_incident(project_id)
            
            elif check_result['ok']:
                # Project is healthy
                logger.info(f"✓ {project_name} ({check_result['response_time_ms']}ms)", "🟢")
        
        except Exception as e:
            logger.error(f"Error checking {project_name}: {str(e)}")
    
    async def _check_url(self, url: str) -> Dict[str, Any]:
        """
        Perform HTTP GET request to check URL health.
        
        Args:
            url: URL to check
        
        Returns:
            Dict with keys: ok (bool), status_code (int), response_time_ms (int), error (str)
        """
        start_time = time.time()
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=self.timeout)) as response:
                    response_time_ms = int((time.time() - start_time) * 1000)
                    
                    # Check if response indicates failure
                    if response.status >= 500:
                        return {
                            'ok': False,
                            'status_code': response.status,
                            'response_time_ms': response_time_ms,
                            'error': f'HTTP {response.status}'
                        }
                    
                    # Check if response is too slow
                    if response_time_ms > 8000:
                        return {
                            'ok': False,
                            'status_code': response.status,
                            'response_time_ms': response_time_ms,
                            'error': 'Response time exceeded 8000ms'
                        }
                    
                    return {
                        'ok': True,
                        'status_code': response.status,
                        'response_time_ms': response_time_ms,
                        'error': None
                    }
        
        except asyncio.TimeoutError:
            response_time_ms = int((time.time() - start_time) * 1000)
            return {
                'ok': False,
                'status_code': 0,
                'response_time_ms': response_time_ms,
                'error': 'Connection timeout'
            }
        
        except aiohttp.ClientConnectorError:
            response_time_ms = int((time.time() - start_time) * 1000)
            return {
                'ok': False,
                'status_code': 0,
                'response_time_ms': response_time_ms,
                'error': 'Connection refused'
            }
        
        except Exception as e:
            response_time_ms = int((time.time() - start_time) * 1000)
            return {
                'ok': False,
                'status_code': 0,
                'response_time_ms': response_time_ms,
                'error': f'Service unreachable: {str(e)}'
            }
    
    async def _create_incident(self, project: Dict, check_result: Dict):
        """
        Create a new incident when a project goes down.
        
        Args:
            project: Project data
            check_result: Result from _check_url
        """
        try:
            # Generate incident ID
            response = self.client.client.table('incidents').select('id').execute()
            incident_count = len(response.data) if response.data else 0
            incident_id = f"INC-{incident_count + 1:04d}"
            
            # Determine error type and severity
            error = check_result['error']
            if 'timeout' in error.lower():
                error_type = 'Connection timeout'
                severity = 'CRITICAL'
            elif 'refused' in error.lower():
                error_type = 'Connection refused'
                severity = 'CRITICAL'
            elif check_result['status_code'] >= 500:
                error_type = f"HTTP {check_result['status_code']} Internal Server Error"
                severity = 'CRITICAL'
            elif check_result['response_time_ms'] > 8000:
                error_type = 'Response time exceeded threshold'
                severity = 'HIGH'
            else:
                error_type = 'Service unreachable'
                severity = 'CRITICAL'
            
            # Build real log text
            timestamp = datetime.utcnow().isoformat() + 'Z'
            logs = f"""[{timestamp}] [ERROR] {project['name']}: {error}
[{timestamp}] [ERROR] URL checked: {project['demo_url']}
[{timestamp}] [ERROR] Response time: {check_result['response_time_ms']}ms
[{timestamp}] [ERROR] Status code: {check_result['status_code']}
[{timestamp}] [WARN]  Health check failing - incident created"""
            
            # Fetch recent commits from GitHub
            commits = await self._fetch_github_commits(project['repo_url'])
            
            # Insert incident
            incident_data = {
                'id': incident_id,
                'service': project['name'],
                'error_type': error_type,
                'severity': severity,
                'status': 'pending_analysis',
                'started_at': timestamp,
                'logs': logs,
                'commits': commits
            }
            
            self.client.client.table('incidents').insert(incident_data).execute()
            
            # Track this project as down
            self.down_projects[project['id']] = incident_id
            
            logger.incident_detected(incident_id, project['name'], error_type, severity)
        
        except Exception as e:
            logger.error(f"Failed to create incident: {str(e)}")
    
    async def _resolve_incident(self, project_id: str):
        """
        Resolve an incident when a project recovers.
        
        Args:
            project_id: ID of the project that recovered
        """
        try:
            incident_id = self.down_projects.get(project_id)
            if not incident_id:
                return
            
            # Update incident as resolved
            self.client.client.table('incidents') \
                .update({
                    'status': 'resolved',
                    'resolved_at': datetime.utcnow().isoformat()
                }) \
                .eq('id', incident_id) \
                .execute()
            
            # Remove from down_projects tracking
            del self.down_projects[project_id]
            
            logger.success(f"Incident {incident_id} auto-resolved", "✅")
        
        except Exception as e:
            logger.error(f"Failed to resolve incident: {str(e)}")
    
    async def _fetch_github_commits(self, repo_url: str) -> List[Dict]:
        """
        Fetch recent commits from GitHub API.
        
        Args:
            repo_url: GitHub repository URL
        
        Returns:
            List of commit objects with sha, message, author, date
        """
        try:
            if 'github.com' not in repo_url:
                return []
            
            # Extract owner/repo from URL
            parts = repo_url.replace('https://github.com/', '').replace('.git', '').split('/')
            if len(parts) < 2:
                return []
            
            owner, repo = parts[0], parts[1]
            api_url = f"https://api.github.com/repos/{owner}/{repo}/commits?per_page=5"
            
            async with aiohttp.ClientSession() as session:
                headers = {'Accept': 'application/vnd.github.v3+json'}
                
                # Add GitHub token if available
                github_token = os.getenv('GITHUB_TOKEN')
                if github_token:
                    headers['Authorization'] = f'Bearer {github_token}'
                
                async with session.get(api_url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status != 200:
                        return []
                    
                    data = await response.json()
                    
                    commits = []
                    for commit in data:
                        commits.append({
                            'sha': commit['sha'][:7],
                            'message': commit['commit']['message'].split('\n')[0][:100],
                            'author': commit['commit']['author']['name'],
                            'date': commit['commit']['author']['date']
                        })
                    
                    return commits
        
        except Exception as e:
            logger.error(f"Failed to fetch GitHub commits: {str(e)}")
            return []
    
    async def _shutdown(self):
        """Gracefully shutdown the monitor agent."""
        logger.info("Shutting down monitor agent...", "🛑")
        
        if self._subscription:
            try:
                self.client.client.remove_channel(self._subscription)
            except Exception:
                pass
        
        logger.success("Monitor agent stopped", "👋")


async def main():
    """Main entry point for the monitor agent."""
    agent = MonitorAgent()
    await agent.start()


if __name__ == "__main__":
    """
    Run the monitor agent standalone.
    
    Usage:
        python monitor_agent.py
    
    Environment Variables:
        SUPABASE_URL - Your Supabase project URL
        SUPABASE_ANON_KEY - Your Supabase anonymous key
        MONITOR_INTERVAL_SECONDS - Check interval (default: 30)
        MONITOR_TIMEOUT_SECONDS - Request timeout (default: 10)
        GITHUB_TOKEN - Optional GitHub token for API access
    """
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n")
        logger.info("Monitor agent stopped by user", "👋")
    except Exception as e:
        logger.critical(f"Fatal error: {str(e)}")

# Made with Bob
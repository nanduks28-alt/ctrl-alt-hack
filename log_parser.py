#!/usr/bin/env python3
"""
=============================================================
SRE-Bot — Log Parser
log_parser.py — Analyzes incident logs for service issues
=============================================================

This script connects to Supabase, fetches recent incidents,
and detects service issues by scanning log messages for
error keywords. It focuses on errors from the last 5 minutes
and returns structured data about critical issues.

Usage:
    python log_parser.py

Requirements:
    pip install supabase-py python-dotenv
"""

import os
import json
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from dotenv import load_dotenv
from supabase import create_client, Client

# ─────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────

# Load environment variables from .env file
load_dotenv()

# Supabase credentials from environment variables
# These should match the variable names in .env.example:
# SUPABASE_URL and SUPABASE_ANON_KEY
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY')

# Error keywords to detect in log messages
ERROR_KEYWORDS = [
    'timeout',
    'error',
    'unreachable',
    'failed',
    '500',
    '503'
]

# Critical threshold: if error_count exceeds this, mark as critical
CRITICAL_THRESHOLD = 3

# Time window: only count errors from the last N minutes
TIME_WINDOW_MINUTES = 5


# ─────────────────────────────────────────────────────────
# SUPABASE CONNECTION
# ─────────────────────────────────────────────────────────

def get_supabase_client() -> Client:
    """
    Creates and returns a Supabase client using credentials
    from environment variables.
    
    Returns:
        Client: Authenticated Supabase client
        
    Raises:
        ValueError: If credentials are missing
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError(
            "Missing Supabase credentials. "
            "Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file."
        )
    
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ─────────────────────────────────────────────────────────
# DATA FETCHING
# ─────────────────────────────────────────────────────────

def fetch_recent_incidents(client: Client, limit: int = 100) -> List[Dict]:
    """
    Fetches the latest incidents from the incidents table.
    
    The incidents table has these columns (from schema.sql):
    - id: text (primary key, e.g., "INC-0001")
    - service: text (service name)
    - error_type: text (error description)
    - severity: text (CRITICAL | HIGH | MEDIUM)
    - status: text (active | resolved)
    - started_at: timestamptz (when incident began)
    - resolved_at: timestamptz (when resolved, nullable)
    - logs: text (raw log dump as text)
    - commits: jsonb (recent commits array)
    - root_cause: text (Bob's analysis)
    - suggested_fix: text (Bob's suggestion)
    - confidence: int (Bob's confidence 0-100)
    
    Args:
        client: Supabase client instance
        limit: Maximum number of rows to fetch (default: 100)
        
    Returns:
        List of incident dictionaries
    """
    try:
        response = client.table('incidents') \
            .select('*') \
            .order('started_at', desc=True) \
            .limit(limit) \
            .execute()
        
        return response.data if response.data else []
    
    except Exception as e:
        print(f"Error fetching incidents: {e}")
        return []


# ─────────────────────────────────────────────────────────
# LOG ANALYSIS
# ─────────────────────────────────────────────────────────

def detect_errors_in_logs(logs: str, keywords: List[str]) -> int:
    """
    Scans log text for error keywords and counts occurrences.
    
    Performs case-insensitive matching for each keyword.
    
    Args:
        logs: Raw log text to analyze
        keywords: List of error keywords to search for
        
    Returns:
        Total count of error keyword occurrences
    """
    if not logs:
        return 0
    
    logs_lower = logs.lower()
    error_count = 0
    
    for keyword in keywords:
        # Count occurrences of each keyword (case-insensitive)
        error_count += logs_lower.count(keyword.lower())
    
    return error_count


def is_within_time_window(timestamp_str: str, minutes: int) -> bool:
    """
    Checks if a timestamp is within the last N minutes.
    
    Args:
        timestamp_str: ISO 8601 timestamp string
        minutes: Time window in minutes
        
    Returns:
        True if timestamp is within the time window, False otherwise
    """
    try:
        # Parse the timestamp (assumes ISO 8601 format with timezone)
        incident_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        
        # Get current time in UTC
        now = datetime.now(timezone.utc)
        
        # Calculate time difference
        time_diff = now - incident_time
        
        # Check if within the time window
        return time_diff <= timedelta(minutes=minutes)
    
    except (ValueError, AttributeError) as e:
        print(f"Error parsing timestamp '{timestamp_str}': {e}")
        return False


def analyze_incidents(incidents: List[Dict]) -> List[Dict]:
    """
    Analyzes incidents to detect service issues.
    
    For each incident:
    1. Checks if it's within the last 5 minutes
    2. Scans logs for error keywords
    3. Counts errors
    4. Determines if it's critical (error_count > 3)
    
    Args:
        incidents: List of incident dictionaries from Supabase
        
    Returns:
        List of analysis results, each containing:
        - service_name: str
        - error_type: str
        - error_count: int
        - latest_timestamp: str
        - is_critical: bool
    """
    results = []
    
    for incident in incidents:
        # Extract incident data
        service_name = incident.get('service', 'unknown')
        error_type = incident.get('error_type', 'unknown error')
        started_at = incident.get('started_at')
        logs = incident.get('logs', '')
        
        # Skip if no timestamp
        if not started_at:
            continue
        
        # Only analyze incidents from the last 5 minutes
        if not is_within_time_window(started_at, TIME_WINDOW_MINUTES):
            continue
        
        # Detect errors in logs
        error_count = detect_errors_in_logs(logs, ERROR_KEYWORDS)
        
        # Determine if critical
        is_critical = error_count > CRITICAL_THRESHOLD
        
        # Build result dictionary
        result = {
            'service_name': service_name,
            'error_type': error_type,
            'error_count': error_count,
            'latest_timestamp': started_at,
            'is_critical': is_critical
        }
        
        results.append(result)
    
    return results


# ─────────────────────────────────────────────────────────
# MAIN FUNCTION
# ─────────────────────────────────────────────────────────

def main():
    """
    Main function that orchestrates the log parsing workflow:
    1. Connects to Supabase
    2. Fetches latest 100 incidents
    3. Analyzes logs for errors in the last 5 minutes
    4. Prints results as JSON
    """
    try:
        # Step 1: Connect to Supabase
        print("Connecting to Supabase...")
        client = get_supabase_client()
        print("[OK] Connected successfully\n")
        
        # Step 2: Fetch recent incidents
        print("Fetching latest 100 incidents...")
        incidents = fetch_recent_incidents(client, limit=100)
        print(f"[OK] Fetched {len(incidents)} incidents\n")
        
        # Step 3: Analyze incidents for errors
        print(f"Analyzing incidents from the last {TIME_WINDOW_MINUTES} minutes...")
        results = analyze_incidents(incidents)
        print(f"[OK] Found {len(results)} incidents in time window\n")
        
        # Step 4: Print results as JSON
        print("=" * 60)
        print("ANALYSIS RESULTS")
        print("=" * 60)
        print(json.dumps(results, indent=2))
        
        # Summary statistics
        critical_count = sum(1 for r in results if r['is_critical'])
        total_errors = sum(r['error_count'] for r in results)
        
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Total incidents analyzed: {len(results)}")
        print(f"Critical incidents: {critical_count}")
        print(f"Total errors detected: {total_errors}")
        print("=" * 60)
        
    except ValueError as e:
        print(f"Configuration error: {e}")
        print("\nPlease ensure your .env file contains:")
        print("  SUPABASE_URL=https://your-project.supabase.co")
        print("  SUPABASE_ANON_KEY=your-anon-key-here")
        
    except Exception as e:
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()


# ─────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────

if __name__ == '__main__':
    main()

# Made with Bob

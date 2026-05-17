#!/usr/bin/env python3
"""
Test Workflow - End-to-End Testing for SRE-Bot Orchestrator
============================================================

This script tests the complete incident response workflow:
1. Creates a test incident in Supabase
2. Verifies orchestrator processes it
3. Checks workflow stages
4. Validates final results

Usage:
    python test_workflow.py

Author: SRE-Bot Team
"""

import asyncio
import time
from datetime import datetime
from typing import Dict, Any, Optional

from workflow_logger import logger
from supabase_client import get_client, SupabaseClientWrapper
from workflow_manager import process_incident


class WorkflowTester:
    """
    End-to-end workflow testing suite.
    """
    
    def __init__(self):
        """Initialize the tester."""
        self.client: Optional[SupabaseClientWrapper] = None
        self.test_incident_id = None
        self.tests_passed = 0
        self.tests_failed = 0
    
    def setup(self):
        """Setup test environment."""
        logger.header("🧪 SRE-Bot Workflow Test Suite", "End-to-End Integration Testing")
        
        logger.info("Setting up test environment...", "🔧")
        
        try:
            self.client = get_client()
            
            if not self.client.test_connection():
                logger.error("Failed to connect to Supabase")
                return False
            
            logger.success("Connected to Supabase")
            return True
            
        except Exception as e:
            logger.error(f"Setup failed: {str(e)}")
            return False
    
    def test_supabase_connection(self) -> bool:
        """Test 1: Supabase connection"""
        logger.separator()
        logger.info("TEST 1: Supabase Connection", "🧪")
        
        try:
            if self.client.test_connection():
                logger.success("✅ Supabase connection successful")
                self.tests_passed += 1
                return True
            else:
                logger.error("❌ Supabase connection failed")
                self.tests_failed += 1
                return False
        except Exception as e:
            logger.error(f"❌ Test failed: {str(e)}")
            self.tests_failed += 1
            return False
    
    def test_create_incident(self) -> bool:
        """Test 2: Create test incident"""
        logger.separator()
        logger.info("TEST 2: Create Test Incident", "🧪")
        
        try:
            # Generate test incident ID
            timestamp = int(time.time())
            self.test_incident_id = f"TEST-{timestamp}"
            
            # Create test incident
            test_data = {
                'id': self.test_incident_id,
                'service': 'test-service',
                'error_type': 'timeout',
                'severity': 'CRITICAL',
                'status': 'pending_analysis',
                'started_at': datetime.utcnow().isoformat(),
                'logs': 'ERROR: Test timeout\nERROR: Connection failed\nERROR: Service unreachable',
                'workflow_stage': 'created'
            }
            
            logger.info(f"Creating test incident: {self.test_incident_id}")
            
            if not self.client:
                raise Exception("Client not initialized")
            
            response = self.client.client.table('incidents').insert(test_data).execute()
            
            if response.data:
                logger.success(f"✅ Test incident created: {self.test_incident_id}")
                self.tests_passed += 1
                return True
            else:
                logger.error("❌ Failed to create test incident")
                self.tests_failed += 1
                return False
                
        except Exception as e:
            logger.error(f"❌ Test failed: {str(e)}")
            self.tests_failed += 1
            return False
    
    async def test_workflow_execution(self) -> bool:
        """Test 3: Execute workflow"""
        logger.separator()
        logger.info("TEST 3: Workflow Execution", "🧪")
        
        if not self.test_incident_id:
            logger.error("❌ No test incident ID available")
            self.tests_failed += 1
            return False
        
        try:
            logger.info(f"Processing incident: {self.test_incident_id}")
            
            # Process the incident through the workflow
            success = await process_incident(self.test_incident_id)
            
            if success:
                logger.success("✅ Workflow executed successfully")
                self.tests_passed += 1
                return True
            else:
                logger.error("❌ Workflow execution failed")
                self.tests_failed += 1
                return False
                
        except Exception as e:
            logger.error(f"❌ Test failed: {str(e)}")
            self.tests_failed += 1
            return False
    
    def test_verify_results(self) -> bool:
        """Test 4: Verify workflow results"""
        logger.separator()
        logger.info("TEST 4: Verify Results", "🧪")
        
        if not self.test_incident_id:
            logger.error("❌ No test incident ID available")
            self.tests_failed += 1
            return False
        
        try:
            if not self.client:
                raise Exception("Client not initialized")
            
            # Fetch the processed incident
            incident = self.client.get_incident(self.test_incident_id)
            
            if not incident:
                logger.error("❌ Could not fetch processed incident")
                self.tests_failed += 1
                return False
            
            # Verify workflow completion
            checks = []
            
            # Check 1: Workflow stage is completed
            if incident.get('workflow_stage') == 'completed':
                logger.success("  ✅ Workflow stage: completed")
                checks.append(True)
            else:
                logger.error(f"  ❌ Workflow stage: {incident.get('workflow_stage')}")
                checks.append(False)
            
            # Check 2: Status is resolved or analyzed
            status = incident.get('status')
            if status in ['resolved', 'analyzed']:
                logger.success(f"  ✅ Status: {status}")
                checks.append(True)
            else:
                logger.error(f"  ❌ Status: {status}")
                checks.append(False)
            
            # Check 3: Recovery was attempted
            if incident.get('recovery_attempted'):
                logger.success("  ✅ Recovery attempted")
                checks.append(True)
            else:
                logger.warn("  ⚠️  Recovery not attempted")
                checks.append(True)  # Not a failure
            
            # Check 4: Has root cause (if analyzed)
            if status == 'analyzed':
                if incident.get('root_cause'):
                    logger.success("  ✅ Root cause identified")
                    checks.append(True)
                else:
                    logger.error("  ❌ No root cause")
                    checks.append(False)
            
            # Check 5: Processed timestamp exists
            if incident.get('processed_at'):
                logger.success("  ✅ Processed timestamp set")
                checks.append(True)
            else:
                logger.error("  ❌ No processed timestamp")
                checks.append(False)
            
            if all(checks):
                logger.success("✅ All verification checks passed")
                self.tests_passed += 1
                return True
            else:
                logger.error("❌ Some verification checks failed")
                self.tests_failed += 1
                return False
                
        except Exception as e:
            logger.error(f"❌ Test failed: {str(e)}")
            self.tests_failed += 1
            return False
    
    def test_cleanup(self) -> bool:
        """Test 5: Cleanup test data"""
        logger.separator()
        logger.info("TEST 5: Cleanup", "🧪")
        
        if not self.test_incident_id:
            logger.warn("No test incident to clean up")
            return True
        
        try:
            if not self.client:
                raise Exception("Client not initialized")
            
            logger.info(f"Deleting test incident: {self.test_incident_id}")
            
            response = self.client.client.table('incidents').delete().eq('id', self.test_incident_id).execute()
            
            logger.success("✅ Test incident deleted")
            self.tests_passed += 1
            return True
            
        except Exception as e:
            logger.error(f"❌ Cleanup failed: {str(e)}")
            logger.warn("You may need to manually delete the test incident")
            self.tests_failed += 1
            return False
    
    def display_summary(self):
        """Display test summary."""
        logger.separator()
        logger.info("TEST SUMMARY", "📊")
        
        total = self.tests_passed + self.tests_failed
        pass_rate = (self.tests_passed / total * 100) if total > 0 else 0
        
        print(f"  Total tests:  {total}")
        print(f"  Passed:       {self.tests_passed} ✅")
        print(f"  Failed:       {self.tests_failed} ❌")
        print(f"  Pass rate:    {pass_rate:.1f}%")
        
        logger.separator()
        
        if self.tests_failed == 0:
            logger.success("🎉 ALL TESTS PASSED!", "✅")
        else:
            logger.error(f"⚠️  {self.tests_failed} TEST(S) FAILED", "❌")
    
    async def run_all_tests(self):
        """Run all tests in sequence."""
        if not self.setup():
            logger.critical("Setup failed. Cannot run tests.")
            return
        
        # Run tests
        self.test_supabase_connection()
        self.test_create_incident()
        await self.test_workflow_execution()
        self.test_verify_results()
        self.test_cleanup()
        
        # Display summary
        self.display_summary()


async def main():
    """Main test entry point."""
    tester = WorkflowTester()
    await tester.run_all_tests()


if __name__ == "__main__":
    """
    Run the test suite.
    
    This will:
    1. Connect to Supabase
    2. Create a test incident
    3. Process it through the workflow
    4. Verify the results
    5. Clean up test data
    """
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n")
        logger.warn("Tests interrupted by user", "⌨️")
    except Exception as e:
        logger.critical(f"Test suite failed: {str(e)}")

# Made with Bob
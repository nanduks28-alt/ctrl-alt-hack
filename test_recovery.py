"""
Recovery Engine Test Suite
===========================

This script tests the recovery_engine.py module with various incident scenarios
to validate recovery strategies and demonstrate functionality.

Usage:
    python test_recovery.py

Output:
    - Detailed console logs for each test case
    - Summary statistics of recovery attempts
    - Success/failure breakdown by error type
"""

import sys
import io

# Fix Windows console encoding for Unicode characters
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from recovery_engine import attempt_recovery, safe_attempt_recovery, get_recovery_statistics


def print_header(title: str) -> None:
    """Print a formatted section header."""
    print("\n" + "="*70)
    print(f"  {title}")
    print("="*70 + "\n")


def print_test_result(test_num: int, service: str, error: str, result: dict) -> None:
    """Print formatted test result."""
    status_icon = "✅" if result['success'] else "❌"
    print(f"\n{status_icon} Test #{test_num} Result:")
    print(f"   Service:  {service}")
    print(f"   Error:    {error}")
    print(f"   Success:  {result['success']}")
    print(f"   Action:   {result['action']}")
    print(f"   Message:  {result['message']}")


def run_test_suite() -> None:
    """
    Run comprehensive test suite for the recovery engine.
    Tests multiple services with different error types.
    """
    
    print_header("🧪 RECOVERY ENGINE TEST SUITE")
    print("Testing automatic recovery attempts for various incident scenarios...")
    print("Each test simulates a real-world service failure and recovery attempt.\n")
    
    # Define test cases: (service_name, error_type, description)
    test_cases = [
        ("payment-api", "timeout", "Payment API experiencing connection timeouts"),
        ("auth-service", "database", "Authentication service database connection issues"),
        ("cache-server", "memory", "Cache server running out of memory"),
        ("user-api", "authentication", "User API authentication token expired"),
        ("notification-service", "connection", "Notification service network connectivity issues"),
        ("file-storage", "disk", "File storage service disk space exhausted"),
        ("analytics-engine", "cpu", "Analytics engine CPU overload"),
        ("webhook-handler", "unknown", "Webhook handler experiencing unknown errors"),
        ("email-service", "timeout", "Email service timeout during send operations"),
        ("search-api", "memory", "Search API memory leak detected")
    ]
    
    # Track results for summary
    results = []
    
    # Run each test case
    for i, (service, error, description) in enumerate(test_cases, 1):
        print(f"\n{'─'*70}")
        print(f"Test Case #{i}: {description}")
        print(f"{'─'*70}")
        
        # Attempt recovery
        result = attempt_recovery(service, error)
        results.append(result)
        
        # Print result
        print_test_result(i, service, error, result)
        
        # Small delay between tests for readability
        import time
        time.sleep(0.5)
    
    # Print summary statistics
    print_summary(results, len(test_cases))


def print_summary(results: list, total_tests: int) -> None:
    """
    Print summary statistics of all test results.
    
    Args:
        results (list): List of result dictionaries from recovery attempts
        total_tests (int): Total number of tests run
    """
    
    print_header("📊 TEST SUMMARY")
    
    # Calculate statistics
    successful = sum(1 for r in results if r['success'])
    failed = total_tests - successful
    success_rate = (successful / total_tests) * 100
    
    # Count by action type
    action_counts = {}
    for result in results:
        action = result['action']
        action_counts[action] = action_counts.get(action, 0) + 1
    
    # Print overall statistics
    print(f"Total Tests Run:        {total_tests}")
    print(f"Successful Recoveries:  {successful} ({success_rate:.1f}%)")
    print(f"Failed Recoveries:      {failed} ({100-success_rate:.1f}%)")
    print(f"\nRecovery Actions Used:")
    
    for action, count in sorted(action_counts.items()):
        print(f"  • {action}: {count} time(s)")
    
    # Print interpretation
    print("\n" + "─"*70)
    print("INTERPRETATION:")
    print("─"*70)
    
    if success_rate >= 60:
        print("✅ Recovery engine is performing well.")
        print("   Most incidents are being resolved automatically.")
    else:
        print("⚠️  Recovery engine success rate is below expected threshold.")
        print("   Consider reviewing recovery strategies.")
    
    print("\nFailed recoveries will be escalated to Bob AI for deeper analysis.")
    print("This two-tier approach ensures optimal incident response.")


def test_exception_handling() -> None:
    """Test the safe_attempt_recovery wrapper with edge cases."""
    
    print_header("🛡️  EXCEPTION HANDLING TEST")
    print("Testing recovery engine with edge cases and error conditions...\n")
    
    # Test with empty strings
    print("Test: Empty service name and error type")
    result = safe_attempt_recovery("", "")
    print(f"Result: {result}\n")
    
    # Test with very long strings
    print("Test: Very long service name")
    long_service = "a" * 1000
    result = safe_attempt_recovery(long_service, "timeout")
    print(f"Result: Success={result['success']}, Action={result['action']}\n")
    
    # Test with special characters
    print("Test: Special characters in inputs")
    result = safe_attempt_recovery("service-@#$%", "error!@#")
    print(f"Result: Success={result['success']}, Action={result['action']}\n")
    
    print("✅ Exception handling tests completed successfully.")


def display_engine_info() -> None:
    """Display recovery engine capabilities and statistics."""
    
    print_header("ℹ️  RECOVERY ENGINE INFORMATION")
    
    stats = get_recovery_statistics()
    
    print("Supported Error Types:")
    for error_type in stats['supported_error_types']:
        print(f"  • {error_type}")
    
    print(f"\nAverage Recovery Time:  {stats['average_recovery_time']}")
    print(f"Expected Success Rate:  {stats['success_rate']}")
    print(f"Escalation Threshold:   {stats['escalation_threshold']}")
    
    print("\n" + "─"*70)
    print("INTEGRATION NOTES:")
    print("─"*70)
    print("• This recovery engine will be integrated with watsonx Orchestrate")
    print("• Failed recoveries automatically escalate to Bob AI")
    print("• All recovery attempts are logged to the SRE dashboard")
    print("• Recovery strategies can be customized per service")


def main() -> None:
    """Main test execution function."""
    
    print("\n" + "="*70)
    print("  🚀 RECOVERY ENGINE - COMPREHENSIVE TEST SUITE")
    print("="*70)
    print("\nThis test suite validates the automatic recovery engine that")
    print("attempts to resolve incidents before escalating to Bob AI.\n")
    
    try:
        # Display engine information
        display_engine_info()
        
        # Run main test suite
        run_test_suite()
        
        # Test exception handling
        test_exception_handling()
        
        # Final message
        print_header("✅ ALL TESTS COMPLETED")
        print("The recovery engine is ready for integration with:")
        print("  • watsonx Orchestrate agents")
        print("  • Bob AI escalation workflow")
        print("  • SRE Dashboard activity feed")
        print("\nNext steps:")
        print("  1. Integrate with incident detection system")
        print("  2. Connect to Bob AI escalation pipeline")
        print("  3. Configure service-specific recovery strategies")
        print("  4. Set up monitoring and alerting")
        print()
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Test suite interrupted by user.")
        print("Exiting gracefully...\n")
        sys.exit(0)
    except Exception as e:
        print(f"\n\n❌ CRITICAL ERROR in test suite: {str(e)}")
        print("Please check the recovery_engine.py module.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()

# Made with Bob

"""
Workflow Logger - Beautiful Console Logging for SRE-Bot Orchestrator
====================================================================

Provides structured, colored console output for the orchestrator service
with timestamps, log levels, and incident context tracking.

Author: SRE-Bot Team
"""

import sys
from datetime import datetime
from typing import Optional

# ANSI color codes for terminal output
class Colors:
    """ANSI color codes for terminal styling"""
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'
    
    # Foreground colors
    BLACK = '\033[30m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'
    
    # Bright foreground colors
    BRIGHT_BLACK = '\033[90m'
    BRIGHT_RED = '\033[91m'
    BRIGHT_GREEN = '\033[92m'
    BRIGHT_YELLOW = '\033[93m'
    BRIGHT_BLUE = '\033[94m'
    BRIGHT_MAGENTA = '\033[95m'
    BRIGHT_CYAN = '\033[96m'
    BRIGHT_WHITE = '\033[97m'
    
    # Background colors
    BG_RED = '\033[41m'
    BG_GREEN = '\033[42m'
    BG_YELLOW = '\033[43m'
    BG_BLUE = '\033[44m'


class WorkflowLogger:
    """
    Structured logger for orchestrator workflow with beautiful console output.
    
    Features:
        - Colored output based on log level
        - Timestamps for all entries
        - Incident context tracking
        - Structured formatting
        - Progress indicators
    """
    
    def __init__(self, service_name: str = "Orchestrator"):
        """
        Initialize the workflow logger.
        
        Args:
            service_name: Name of the service (default: "Orchestrator")
        """
        self.service_name = service_name
        self.current_incident_id: Optional[str] = None
        self.use_colors = self._supports_color()
    
    def _supports_color(self) -> bool:
        """
        Check if the terminal supports ANSI color codes.
        
        Returns:
            bool: True if colors are supported
        """
        # Check if stdout is a terminal
        if not hasattr(sys.stdout, 'isatty'):
            return False
        if not sys.stdout.isatty():
            return False
        # Windows check
        if sys.platform == 'win32':
            try:
                import colorama
                colorama.init()
                return True
            except ImportError:
                return False
        return True
    
    def _colorize(self, text: str, color: str) -> str:
        """
        Apply color to text if colors are supported.
        
        Args:
            text: Text to colorize
            color: ANSI color code
            
        Returns:
            str: Colored text or plain text
        """
        if self.use_colors:
            return f"{color}{text}{Colors.RESET}"
        return text
    
    def _timestamp(self) -> str:
        """
        Get current timestamp in HH:MM:SS format.
        
        Returns:
            str: Formatted timestamp
        """
        now = datetime.now()
        return now.strftime("%H:%M:%S")
    
    def _format_message(self, level: str, message: str, icon: str = "") -> str:
        """
        Format a log message with timestamp and level.
        
        Args:
            level: Log level (INFO, WARN, ERROR, SUCCESS)
            message: Log message
            icon: Optional emoji icon
            
        Returns:
            str: Formatted log message
        """
        ts = self._colorize(f"[{self._timestamp()}]", Colors.BRIGHT_BLACK)
        
        if self.current_incident_id:
            incident = self._colorize(f"[{self.current_incident_id}]", Colors.CYAN)
            return f"{ts} {incident} {icon} {message}"
        
        return f"{ts} {icon} {message}"
    
    def set_incident_context(self, incident_id: Optional[str]) -> None:
        """
        Set the current incident ID for context tracking.
        
        Args:
            incident_id: Incident ID to track (None to clear)
        """
        self.current_incident_id = incident_id
    
    def info(self, message: str, icon: str = "ℹ️") -> None:
        """
        Log an informational message.
        
        Args:
            message: Message to log
            icon: Optional icon (default: ℹ️)
        """
        formatted = self._format_message("INFO", message, icon)
        print(formatted)
    
    def success(self, message: str, icon: str = "✅") -> None:
        """
        Log a success message.
        
        Args:
            message: Message to log
            icon: Optional icon (default: ✅)
        """
        colored_msg = self._colorize(message, Colors.GREEN)
        formatted = self._format_message("SUCCESS", colored_msg, icon)
        print(formatted)
    
    def warn(self, message: str, icon: str = "⚠️") -> None:
        """
        Log a warning message.
        
        Args:
            message: Message to log
            icon: Optional icon (default: ⚠️)
        """
        colored_msg = self._colorize(message, Colors.YELLOW)
        formatted = self._format_message("WARN", colored_msg, icon)
        print(formatted)
    
    def error(self, message: str, icon: str = "❌") -> None:
        """
        Log an error message.
        
        Args:
            message: Message to log
            icon: Optional icon (default: ❌)
        """
        colored_msg = self._colorize(message, Colors.RED)
        formatted = self._format_message("ERROR", colored_msg, icon)
        print(formatted, file=sys.stderr)
    
    def critical(self, message: str, icon: str = "🚨") -> None:
        """
        Log a critical error message.
        
        Args:
            message: Message to log
            icon: Optional icon (default: 🚨)
        """
        colored_msg = self._colorize(message, Colors.BRIGHT_RED + Colors.BOLD)
        formatted = self._format_message("CRITICAL", colored_msg, icon)
        print(formatted, file=sys.stderr)
    
    def stage(self, stage_num: int, total_stages: int, description: str) -> None:
        """
        Log a workflow stage header.
        
        Args:
            stage_num: Current stage number
            total_stages: Total number of stages
            description: Stage description
        """
        separator = self._colorize("━━━", Colors.BRIGHT_BLACK)
        stage_text = self._colorize(
            f"Stage {stage_num}/{total_stages}: {description}",
            Colors.BRIGHT_CYAN + Colors.BOLD
        )
        print(f"\n{separator} {stage_text} {separator}")
    
    def separator(self, char: str = "━", length: int = 60) -> None:
        """
        Print a separator line.
        
        Args:
            char: Character to use for separator
            length: Length of separator
        """
        line = self._colorize(char * length, Colors.BRIGHT_BLACK)
        print(line)
    
    def header(self, title: str, subtitle: str = "") -> None:
        """
        Print a formatted header.
        
        Args:
            title: Header title
            subtitle: Optional subtitle
        """
        border = "╔" + "═" * 58 + "╗"
        bottom = "╚" + "═" * 58 + "╝"
        
        print(self._colorize(border, Colors.BRIGHT_CYAN))
        print(self._colorize(f"║  {title:<56}║", Colors.BRIGHT_CYAN))
        if subtitle:
            print(self._colorize(f"║  {subtitle:<56}║", Colors.BRIGHT_BLACK))
        print(self._colorize(bottom, Colors.BRIGHT_CYAN))
        print()
    
    def incident_detected(self, incident_id: str, service: str, error_type: str, severity: str) -> None:
        """
        Log incident detection with formatted details.
        
        Args:
            incident_id: Incident ID
            service: Service name
            error_type: Error type
            severity: Severity level
        """
        self.separator()
        print()
        self.info(self._colorize("NEW INCIDENT DETECTED", Colors.BRIGHT_YELLOW + Colors.BOLD), "🔔")
        print(f"           ID: {self._colorize(incident_id, Colors.CYAN)}")
        print(f"           Service: {self._colorize(service, Colors.BRIGHT_WHITE)}")
        print(f"           Error: {self._colorize(error_type, Colors.YELLOW)}")
        
        severity_color = Colors.RED if severity == "CRITICAL" else Colors.YELLOW
        print(f"           Severity: {self._colorize(severity, severity_color)}")
        print()
    
    def workflow_started(self, incident_id: str) -> None:
        """
        Log workflow start.
        
        Args:
            incident_id: Incident ID
        """
        msg = self._colorize(f"WORKFLOW STARTED: {incident_id}", Colors.BRIGHT_GREEN + Colors.BOLD)
        self.info(msg, "🚀")
    
    def workflow_complete(self, incident_id: str, duration: float, status: str) -> None:
        """
        Log workflow completion.
        
        Args:
            incident_id: Incident ID
            duration: Duration in seconds
            status: Final status
        """
        print()
        msg = self._colorize(f"WORKFLOW COMPLETE: {incident_id}", Colors.BRIGHT_GREEN + Colors.BOLD)
        self.success(msg, "🎉")
        print(f"           Duration: {duration:.1f} seconds")
        print(f"           Status: {self._colorize(status, Colors.GREEN)}")
        print(f"           Next: Engineer review")
        print()
        self.separator()
        print()
    
    def progress(self, message: str, indent: int = 3) -> None:
        """
        Log a progress message with indentation.
        
        Args:
            message: Progress message
            indent: Number of spaces to indent
        """
        ts = self._colorize(f"[{self._timestamp()}]", Colors.BRIGHT_BLACK)
        spaces = " " * indent
        print(f"{ts}{spaces}{message}")


# Global logger instance
logger = WorkflowLogger("SRE-Bot Orchestrator")


# Convenience functions for direct import
def info(message: str, icon: str = "ℹ️") -> None:
    """Log info message"""
    logger.info(message, icon)


def success(message: str, icon: str = "✅") -> None:
    """Log success message"""
    logger.success(message, icon)


def warn(message: str, icon: str = "⚠️") -> None:
    """Log warning message"""
    logger.warn(message, icon)


def error(message: str, icon: str = "❌") -> None:
    """Log error message"""
    logger.error(message, icon)


def critical(message: str, icon: str = "🚨") -> None:
    """Log critical message"""
    logger.critical(message, icon)


def stage(stage_num: int, total_stages: int, description: str) -> None:
    """Log workflow stage"""
    logger.stage(stage_num, total_stages, description)


def set_incident_context(incident_id: Optional[str]) -> None:
    """Set incident context"""
    logger.set_incident_context(incident_id)


if __name__ == "__main__":
    """Demo of logger capabilities"""
    logger.header("🤖 SRE-Bot Orchestrator Service v1.0.0", "Intelligent Incident Response Automation")
    
    logger.info("Connecting to Supabase...", "🔌")
    logger.success("Connected: https://tniqhojcyzfqzcqdaoxi.supabase.co")
    logger.info("Listening for incidents...", "👂")
    logger.success("Orchestrator ready", "💚")
    
    logger.separator()
    
    logger.incident_detected("INC-0001", "payment-api", "timeout", "CRITICAL")
    logger.workflow_started("INC-0001")
    
    logger.set_incident_context("INC-0001")
    
    logger.stage(1, 4, "Log Analysis")
    logger.progress("📝 Analyzing incident logs...")
    logger.progress("✅ Analysis complete")
    logger.progress("📊 Errors detected: 5")
    logger.progress("⚠️  Critical threshold exceeded")
    
    logger.stage(2, 4, "Recovery Attempt")
    logger.progress("🔧 Attempting automatic recovery...")
    logger.progress("🔄 Action: Service restart")
    logger.progress("❌ Recovery failed")
    logger.progress("📈 Escalating to AI analysis...")
    
    logger.stage(3, 4, "Bob AI Analysis")
    logger.progress("🤖 Sending to Bob AI...")
    logger.progress("📊 Root cause identified")
    logger.progress("💡 Suggested fix generated")
    logger.progress("🎯 Confidence: 91%")
    logger.progress("✅ Analysis complete")
    
    logger.stage(4, 4, "Update Database")
    logger.progress("💾 Saving results to Supabase...")
    logger.progress("✅ Incident updated")
    
    logger.workflow_complete("INC-0001", 10.5, "analyzed")
    
    logger.set_incident_context(None)
    logger.info("Listening for incidents...", "👂")

# Made with Bob
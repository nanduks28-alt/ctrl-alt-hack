#!/bin/bash
# =============================================================
# Start Orchestrator Service - Linux/Mac
# =============================================================
# This script starts the SRE-Bot orchestrator service
# Usage: ./start_orchestrator.sh

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🤖 SRE-Bot Orchestrator Service                             ║"
echo "║  Starting incident response automation...                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo ""
    echo "Please create a .env file with your Supabase credentials:"
    echo "  cp .env.example .env"
    echo "  # Edit .env with your SUPABASE_URL and SUPABASE_ANON_KEY"
    echo ""
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    echo "Please install Python 3.7 or higher"
    exit 1
fi

# Check if dependencies are installed
echo "📦 Checking dependencies..."
if ! python3 -c "import supabase" 2>/dev/null; then
    echo "⚠️  Dependencies not installed. Installing..."
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
    echo "✅ Dependencies installed"
fi

echo "✅ All checks passed"
echo ""
echo "🚀 Starting orchestrator service..."
echo "   Press Ctrl+C to stop"
echo ""

# Start the orchestrator
python3 orchestrator_service.py

# Made with Bob
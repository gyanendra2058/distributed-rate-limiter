#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load EC2 env if available
ENV_FILE="$SCRIPT_DIR/.env.ec2"
if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
  BASE_URL="http://${PUBLIC_IP}:8080"
  echo "Using EC2 target: $BASE_URL"
else
  BASE_URL="${BASE_URL:-http://localhost:8080}"
  echo "No .env.ec2 found, using: $BASE_URL"
fi

# Check k6 is installed
if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 is not installed."
  echo "Install: brew install k6  (macOS) or see https://k6.io/docs/get-started/installation/"
  exit 1
fi

TEST="${1:-ramp-stress-test.js}"
TEST_FILE="$PROJECT_DIR/k6/$TEST"

if [ ! -f "$TEST_FILE" ]; then
  echo "ERROR: Test file not found: $TEST_FILE"
  echo "Available tests:"
  ls "$PROJECT_DIR/k6/"*.js 2>/dev/null || echo "  (none)"
  exit 1
fi

echo ""
echo "=== Running k6 test: $TEST ==="
echo "Target: $BASE_URL"
echo ""

k6 run --env BASE_URL="$BASE_URL" "$TEST_FILE"

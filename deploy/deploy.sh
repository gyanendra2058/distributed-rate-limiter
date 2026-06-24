#!/usr/bin/env bash
set -euo pipefail

echo "=== Distributed Rate Limiter - Deploy ==="

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "Docker installed. You may need to log out and back in for group changes."
fi

# Check for Docker Compose plugin
if ! docker compose version &>/dev/null; then
  echo "ERROR: Docker Compose plugin not found. Install with:"
  echo "  sudo apt-get install docker-compose-plugin"
  exit 1
fi

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "Building and starting all services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo ""
echo "=== Deployment Complete ==="
echo "Dashboard:  http://$(hostname -I | awk '{print $1}'):80"
echo "API Gateway (via Nginx LB): http://$(hostname -I | awk '{print $1}'):8080"
echo "Prometheus: http://$(hostname -I | awk '{print $1}'):9090"
echo ""
echo "To view logs: docker compose logs -f"
echo "To stop:      docker compose down"

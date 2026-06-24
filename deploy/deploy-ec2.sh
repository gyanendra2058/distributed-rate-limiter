#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.ec2"
REPO_URL="https://github.com/gyanendra2058/distributed-rate-limiter.git"
REMOTE_DIR="distributed-rate-limiter"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run setup-ec2.sh first."
  exit 1
fi

source "$ENV_FILE"

echo "=== Distributed Rate Limiter — Deploy to EC2 ==="
echo "Instance: $INSTANCE_ID"
echo "IP: $PUBLIC_IP"
echo ""

SSH_CMD="ssh $SSH_OPTS -i $KEY_FILE ec2-user@$PUBLIC_IP"

# Wait for user-data setup to finish
echo "Waiting for Docker installation to complete..."
for i in $(seq 1 30); do
  if $SSH_CMD "test -f /tmp/setup-complete" 2>/dev/null; then
    echo "Docker setup complete."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Timed out waiting for setup. Check instance logs:"
    echo "  $SSH_CMD 'cat /var/log/cloud-init-output.log | tail -30'"
    exit 1
  fi
  echo "  waiting... ($i/30)"
  sleep 10
done

# Clone or pull the repo
echo ""
echo "Syncing code..."
$SSH_CMD "
  if [ -d ~/$REMOTE_DIR ]; then
    echo 'Pulling latest changes...'
    cd ~/$REMOTE_DIR && git pull
  else
    echo 'Cloning repository...'
    git clone $REPO_URL ~/$REMOTE_DIR
  fi
"

# Build and start services (excluding Prometheus, scaling gateway to 1)
echo ""
echo "Building and starting services (this takes 3-5 minutes on first run)..."
$SSH_CMD "
  cd ~/$REMOTE_DIR
  docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    up -d --build --scale api-gateway=1 \
    redis postgres api api-gateway config-service dashboard nginx
"

# Wait for services to be healthy
echo ""
echo "Waiting for services to be healthy..."
sleep 10

$SSH_CMD "
  cd ~/$REMOTE_DIR
  echo '--- Container Status ---'
  docker compose ps
  echo ''
  echo '--- Health Checks ---'
  docker compose ps --format '{{.Name}}: {{.Status}}'
"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Access your app:"
echo "  Dashboard (via Nginx) : http://$PUBLIC_IP:8080/"
echo "  Dashboard (direct)    : http://$PUBLIC_IP/"
echo "  API test              : curl http://$PUBLIC_IP:8080/api/products -H 'X-User-Id: user1'"
echo "  Config                : curl http://$PUBLIC_IP:8080/config/limits"
echo "  Metrics               : curl http://$PUBLIC_IP:8080/metrics"
echo ""
echo "SSH access:"
echo "  $SSH_CMD"
echo ""
echo "View logs:"
echo "  $SSH_CMD 'cd $REMOTE_DIR && docker compose logs -f --tail=50'"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EC2_ENV="$SCRIPT_DIR/.env.ec2"
CACHE_ENV="$SCRIPT_DIR/.env.elasticache"
REGION="${AWS_REGION:-ap-south-1}"

CLUSTER_ID="rate-limiter-redis"
SUBNET_GROUP="rate-limiter-cache-subnet"
CACHE_SG_NAME="rate-limiter-cache-sg"
NODE_TYPE="cache.t3.micro"
ENGINE_VERSION="7.1"

echo "=== Distributed Rate Limiter — ElastiCache Setup ==="
echo "Region: $REGION"
echo ""

if [ -f "$CACHE_ENV" ]; then
  echo "ERROR: $CACHE_ENV already exists. Run teardown-elasticache.sh first."
  exit 1
fi

if [ ! -f "$EC2_ENV" ]; then
  echo "ERROR: $EC2_ENV not found. Run setup-ec2.sh first."
  exit 1
fi

source "$EC2_ENV"
echo "Using VPC/SG context from EC2 setup."
echo ""

# Get VPC ID from the EC2 security group
VPC_ID=$(aws ec2 describe-security-groups \
  --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].VpcId' --output text --region "$REGION")
echo "VPC: $VPC_ID"

# Get all default subnets in the VPC
echo "Finding subnets..."
SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=default-for-az,Values=true" \
  --query 'Subnets[].SubnetId' --output text --region "$REGION")

if [ -z "$SUBNET_IDS" ]; then
  echo "ERROR: No default subnets found in VPC $VPC_ID."
  exit 1
fi
echo "Subnets: $SUBNET_IDS"

# Create cache subnet group
echo ""
echo "Creating cache subnet group..."
EXISTING_SUBNET_GROUP=$(aws elasticache describe-cache-subnet-groups \
  --cache-subnet-group-name "$SUBNET_GROUP" \
  --query 'CacheSubnetGroups[0].CacheSubnetGroupName' --output text --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_SUBNET_GROUP" = "None" ] || [ -z "$EXISTING_SUBNET_GROUP" ]; then
  aws elasticache create-cache-subnet-group \
    --cache-subnet-group-name "$SUBNET_GROUP" \
    --cache-subnet-group-description "Rate limiter ElastiCache subnet group" \
    --subnet-ids $SUBNET_IDS \
    --region "$REGION" >/dev/null
  echo "Cache subnet group created: $SUBNET_GROUP"
else
  echo "Cache subnet group already exists: $SUBNET_GROUP (reusing)"
fi

# Create security group for ElastiCache
echo ""
echo "Creating ElastiCache security group..."
CACHE_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$CACHE_SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text --region "$REGION" 2>/dev/null || echo "None")

if [ "$CACHE_SG_ID" = "None" ] || [ -z "$CACHE_SG_ID" ]; then
  CACHE_SG_ID=$(aws ec2 create-security-group \
    --group-name "$CACHE_SG_NAME" \
    --description "ElastiCache - allow Redis from EC2" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text --region "$REGION")

  aws ec2 authorize-security-group-ingress \
    --group-id "$CACHE_SG_ID" \
    --protocol tcp --port 6379 \
    --source-group "$SG_ID" \
    --region "$REGION" >/dev/null
  echo "Security group created: $CACHE_SG_ID (port 6379 from EC2 SG $SG_ID)"
else
  echo "Security group already exists: $CACHE_SG_ID (reusing)"
fi

# Create ElastiCache cluster (single node)
echo ""
echo "Creating ElastiCache cluster ($NODE_TYPE, Redis $ENGINE_VERSION, single node)..."
echo "This takes 5-10 minutes..."

EXISTING_CLUSTER=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id "$CLUSTER_ID" \
  --query 'CacheClusters[0].CacheClusterId' --output text --region "$REGION" 2>/dev/null || echo "None")

if [ "$EXISTING_CLUSTER" != "None" ] && [ -n "$EXISTING_CLUSTER" ]; then
  echo "Cluster $CLUSTER_ID already exists. Waiting for it to be available..."
else
  aws elasticache create-cache-cluster \
    --cache-cluster-id "$CLUSTER_ID" \
    --cache-node-type "$NODE_TYPE" \
    --engine redis \
    --engine-version "$ENGINE_VERSION" \
    --num-cache-nodes 1 \
    --cache-subnet-group-name "$SUBNET_GROUP" \
    --security-group-ids "$CACHE_SG_ID" \
    --region "$REGION" >/dev/null
  echo "Cluster creation initiated."
fi

# Wait for cluster to be available
echo "Waiting for cluster to become available..."
aws elasticache wait cache-cluster-available \
  --cache-cluster-id "$CLUSTER_ID" \
  --region "$REGION"
echo "Cluster is available."

# Extract endpoint
REDIS_HOST=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id "$CLUSTER_ID" \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' --output text --region "$REGION")

REDIS_PORT=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id "$CLUSTER_ID" \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Port' --output text --region "$REGION")

# Save state
cat > "$CACHE_ENV" <<EOF
CLUSTER_ID=$CLUSTER_ID
REDIS_HOST=$REDIS_HOST
REDIS_PORT=$REDIS_PORT
CACHE_SG_ID=$CACHE_SG_ID
SUBNET_GROUP=$SUBNET_GROUP
REGION=$REGION
EOF

echo ""
echo "=== ElastiCache Setup Complete ==="
echo "Cluster ID  : $CLUSTER_ID"
echo "Endpoint    : $REDIS_HOST:$REDIS_PORT"
echo "Node type   : $NODE_TYPE"
echo "Security Grp: $CACHE_SG_ID"
echo ""
echo "Saved to: $CACHE_ENV"
echo ""
echo "Next step: ./deploy/deploy-ec2.sh"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.ec2"
REGION="${AWS_REGION:-ap-south-1}"
KEY_NAME="rate-limiter-key"
KEY_FILE="$SCRIPT_DIR/${KEY_NAME}.pem"
SG_NAME="rate-limiter-sg"
INSTANCE_TYPE="t2.micro"

echo "=== Distributed Rate Limiter — EC2 Setup ==="
echo "Region: $REGION"
echo ""

if [ -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE already exists. Run teardown-ec2.sh first or delete it manually."
  exit 1
fi

# Detect caller's public IP for SSH access
echo "Detecting your public IP..."
MY_IP=$(curl -s https://checkip.amazonaws.com)
echo "Your IP: $MY_IP"

# Use default VPC
echo "Finding default VPC..."
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --query 'Vpcs[0].VpcId' --output text --region "$REGION")

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "No default VPC found. Creating one..."
  VPC_ID=$(aws ec2 create-default-vpc --query 'Vpc.VpcId' --output text --region "$REGION" 2>/dev/null || true)
  if [ -z "$VPC_ID" ]; then
    echo "ERROR: Could not find or create a default VPC in $REGION."
    echo "Create one manually: aws ec2 create-default-vpc --region $REGION"
    exit 1
  fi
fi
echo "VPC: $VPC_ID"

# Pick a subnet from the default VPC
SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=default-for-az,Values=true" \
  --query 'Subnets[0].SubnetId' --output text --region "$REGION")
echo "Subnet: $SUBNET_ID"

# Create security group
echo "Creating security group..."
SG_ID=$(aws ec2 create-security-group \
  --group-name "$SG_NAME" \
  --description "Rate Limiter Demo - HTTP + SSH" \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text --region "$REGION")

aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr "${MY_IP}/32" --region "$REGION" >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 80 --cidr "0.0.0.0/0" --region "$REGION" >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 8080 --cidr "0.0.0.0/0" --region "$REGION" >/dev/null
echo "Security Group: $SG_ID (SSH from $MY_IP, HTTP 80+8080 open)"

# Create key pair
echo "Creating key pair..."
aws ec2 create-key-pair \
  --key-name "$KEY_NAME" \
  --query 'KeyMaterial' --output text --region "$REGION" > "$KEY_FILE"
chmod 400 "$KEY_FILE"
echo "Key saved: $KEY_FILE"

# Find Amazon Linux 2023 AMI
AMI_ID=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text --region "$REGION")
echo "AMI: $AMI_ID (Amazon Linux 2023)"

# User-data: install Docker, docker-compose, create swap
USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
set -e

# Install Docker
dnf update -y
dnf install -y docker git
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Install Docker Compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Create 1GB swap
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile swap swap defaults 0 0' >> /etc/fstab

echo "SETUP_COMPLETE" > /tmp/setup-complete
USERDATA
)

# Launch instance
echo "Launching t2.micro instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --subnet-id "$SUBNET_ID" \
  --associate-public-ip-address \
  --user-data "$USER_DATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=rate-limiter-demo}]" \
  --query 'Instances[0].InstanceId' --output text --region "$REGION")

echo "Instance: $INSTANCE_ID — waiting for it to start..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text --region "$REGION")

# Save state for deploy and teardown scripts
cat > "$ENV_FILE" <<EOF
INSTANCE_ID=$INSTANCE_ID
PUBLIC_IP=$PUBLIC_IP
SG_ID=$SG_ID
KEY_FILE=$KEY_FILE
KEY_NAME=$KEY_NAME
REGION=$REGION
EOF

echo ""
echo "=== EC2 Setup Complete ==="
echo "Instance ID : $INSTANCE_ID"
echo "Public IP   : $PUBLIC_IP"
echo "Key file    : $KEY_FILE"
echo ""
echo "Docker is being installed via user-data (~60-90 seconds)."
echo "You can check progress with:"
echo "  ssh -i $KEY_FILE ec2-user@$PUBLIC_IP 'cat /tmp/setup-complete'"
echo ""
echo "Next step: ./deploy/deploy-ec2.sh"

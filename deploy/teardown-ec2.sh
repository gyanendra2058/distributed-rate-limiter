#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.ec2"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Nothing to tear down."
  exit 1
fi

source "$ENV_FILE"

echo "=== Distributed Rate Limiter — Teardown ==="
echo ""
echo "This will PERMANENTLY delete:"
echo "  - EC2 instance: $INSTANCE_ID"
echo "  - Security group: $SG_ID"
echo "  - Key pair: $KEY_NAME"
echo ""
read -p "Are you sure? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""

# Terminate EC2 instance
echo "Terminating EC2 instance $INSTANCE_ID..."
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null
echo "Waiting for instance to terminate..."
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID" --region "$REGION"
echo "Instance terminated."

# Delete security group
echo "Deleting security group $SG_ID..."
aws ec2 delete-security-group --group-id "$SG_ID" --region "$REGION"
echo "Security group deleted."

# Delete key pair
echo "Deleting key pair $KEY_NAME..."
aws ec2 delete-key-pair --key-name "$KEY_NAME" --region "$REGION"
rm -f "$KEY_FILE"
echo "Key pair deleted."

# Remove env file
rm -f "$ENV_FILE"

echo ""
echo "=== Teardown Complete ==="
echo "All AWS resources have been deleted."

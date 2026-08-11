#!/usr/bin/env bash
# =============================================================================
# deploy-apprunner.sh — put the APS demo app on AWS App Runner in one command.
#
# This is the artifact of the developer-persona story: "describe it, deploy it,
# get a live HTTPS URL." Kiro generates a script like this from a plain-English
# prompt (see KIRO-PROMPT.md); this committed copy makes the demo repeatable.
#
# What it does:
#   1. Builds the app container (../Dockerfile) and pushes it to Amazon ECR
#   2. Stores your APS Client ID/Secret in AWS Secrets Manager (never in code)
#   3. Creates the two small IAM roles App Runner needs
#   4. Creates the App Runner service and prints the public HTTPS URL
#
# Prereqs: awscli v2, docker (running), and a ../.env with your APS creds.
# Usage:   ./deploy-apprunner.sh [--profile NAME] [--region us-east-1]
# =============================================================================
set -euo pipefail

# ---- config (override with flags / env) ------------------------------------
REGION="${REGION:-us-east-1}"
PROFILE=""
SERVICE_NAME="aps-aws-demo"
ECR_REPO="aps-aws-demo"
SECRET_NAME="aps-aws-demo/creds"
APS_BUCKET="${APS_BUCKET:-aps-aws-demo-au2026}"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --region)  REGION="$2";  shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done
AWS=(aws --region "$REGION"); [ -n "$PROFILE" ] && AWS+=(--profile "$PROFILE")

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # aps-app/ (build context)
cd "$APP_DIR"

# ---- 0. sanity checks -------------------------------------------------------
command -v aws    >/dev/null || { echo "❌ awscli not found"; exit 1; }
command -v docker >/dev/null || { echo "❌ docker not found"; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "❌ $APP_DIR/.env not found — copy .env.example and add your APS creds"; exit 1; }

# shellcheck disable=SC1091
set -a; . "$APP_DIR/.env"; set +a
: "${APS_CLIENT_ID:?APS_CLIENT_ID missing in .env}"
: "${APS_CLIENT_SECRET:?APS_CLIENT_SECRET missing in .env}"

ACCOUNT_ID="$("${AWS[@]}" sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"
echo "▶ Account ${ACCOUNT_ID} · region ${REGION} · service ${SERVICE_NAME}"

# ---- 1. ECR repo + image ----------------------------------------------------
echo "▶ Ensuring ECR repo ${ECR_REPO} …"
"${AWS[@]}" ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1 \
  || "${AWS[@]}" ecr create-repository --repository-name "$ECR_REPO" >/dev/null

echo "▶ Building and pushing image (linux/amd64 for App Runner) …"
"${AWS[@]}" ecr get-login-password | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build --platform linux/amd64 -t "${ECR_REPO}:latest" "$APP_DIR"
docker tag "${ECR_REPO}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"

# ---- 2. Secrets Manager -----------------------------------------------------
echo "▶ Storing APS credentials in Secrets Manager (${SECRET_NAME}) …"
SECRET_JSON="$(printf '{"APS_CLIENT_ID":"%s","APS_CLIENT_SECRET":"%s"}' "$APS_CLIENT_ID" "$APS_CLIENT_SECRET")"
if "${AWS[@]}" secretsmanager describe-secret --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
  "${AWS[@]}" secretsmanager put-secret-value --secret-id "$SECRET_NAME" --secret-string "$SECRET_JSON" >/dev/null
else
  "${AWS[@]}" secretsmanager create-secret --name "$SECRET_NAME" --secret-string "$SECRET_JSON" >/dev/null
fi
SECRET_ARN="$("${AWS[@]}" secretsmanager describe-secret --secret-id "$SECRET_NAME" --query ARN --output text)"

# ---- 3. IAM roles -----------------------------------------------------------
ACCESS_ROLE="AppRunnerECRAccessRole-${SERVICE_NAME}"
INSTANCE_ROLE="AppRunnerInstanceRole-${SERVICE_NAME}"

ensure_role () {  # $1=name  $2=service-principal  $3=trust-desc
  if ! "${AWS[@]}" iam get-role --role-name "$1" >/dev/null 2>&1; then
    echo "▶ Creating IAM role $1 …"
    "${AWS[@]}" iam create-role --role-name "$1" \
      --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$2\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
  fi
}

# 3a. Access role — lets App Runner pull the image from ECR
ensure_role "$ACCESS_ROLE" "build.apprunner.amazonaws.com"
"${AWS[@]}" iam attach-role-policy --role-name "$ACCESS_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess >/dev/null 2>&1 || true
ACCESS_ROLE_ARN="$("${AWS[@]}" iam get-role --role-name "$ACCESS_ROLE" --query Role.Arn --output text)"

# 3b. Instance role — lets the running app read the secret
ensure_role "$INSTANCE_ROLE" "tasks.apprunner.amazonaws.com"
"${AWS[@]}" iam put-role-policy --role-name "$INSTANCE_ROLE" --policy-name read-aps-secret \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"${SECRET_ARN}\"}]}" >/dev/null
INSTANCE_ROLE_ARN="$("${AWS[@]}" iam get-role --role-name "$INSTANCE_ROLE" --query Role.Arn --output text)"

echo "▶ Waiting 15s for IAM role propagation …"; sleep 15

# ---- 4. App Runner service --------------------------------------------------
CONFIG_FILE="$(mktemp)"
cat > "$CONFIG_FILE" <<JSON
{
  "ServiceName": "${SERVICE_NAME}",
  "SourceConfiguration": {
    "AuthenticationConfiguration": { "AccessRoleArn": "${ACCESS_ROLE_ARN}" },
    "AutoDeploymentsEnabled": false,
    "ImageRepository": {
      "ImageIdentifier": "${ECR_URI}:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": { "PORT": "8080", "APS_BUCKET": "${APS_BUCKET}" },
        "RuntimeEnvironmentSecrets": {
          "APS_CLIENT_ID": "${SECRET_ARN}:APS_CLIENT_ID::",
          "APS_CLIENT_SECRET": "${SECRET_ARN}:APS_CLIENT_SECRET::"
        }
      }
    }
  },
  "InstanceConfiguration": { "Cpu": "1024", "Memory": "2048", "InstanceRoleArn": "${INSTANCE_ROLE_ARN}" },
  "HealthCheckConfiguration": { "Protocol": "HTTP", "Path": "/", "Interval": 10, "Timeout": 5, "HealthyThreshold": 1, "UnhealthyThreshold": 5 }
}
JSON

if "${AWS[@]}" apprunner list-services --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" --output text | grep -q apprunner; then
  echo "ℹ️  Service ${SERVICE_NAME} already exists — pushing a new image is enough."
  echo "    (App Runner auto-deploys the :latest tag on next update if enabled, or trigger a manual deploy in the console.)"
else
  echo "▶ Creating App Runner service …"
  "${AWS[@]}" apprunner create-service --cli-input-json "file://${CONFIG_FILE}" >/dev/null
fi
rm -f "$CONFIG_FILE"

SERVICE_URL="$("${AWS[@]}" apprunner list-services --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceUrl" --output text)"
echo ""
echo "✅ Done. App Runner is building/deploying (first deploy ~3-5 min)."
echo "   Live URL:  https://${SERVICE_URL}"
echo "   Watch it:  ${AWS[*]} apprunner list-services"
echo ""
echo "   To tear down later:  ${AWS[*]} apprunner delete-service --service-arn <arn>"

#!/usr/bin/env bash
# One-shot publish for the APS AWS demo repo.
# Usage:  bash push.sh [repo-name]   (default repo name: aps-aws-demo)
set -euo pipefail
cd "$(dirname "$0")"
REPO="${1:-aps-aws-demo}"

# 1. init + commit (safe to re-run)
[ -d .git ] || git init
git add .
echo "── staged files (verify NO node_modules/ or .env below) ──"
git status --short
git commit -m "APS digital twin on AWS — AU 2026 demo" || echo "(nothing new to commit)"

# 2. create the GitHub repo and push
if command -v gh >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source=. --remote=origin --push
  echo "✅ Pushed. Now enable Pages: Settings → Pages → main → /docs"
else
  echo ""
  echo "GitHub CLI (gh) not found. Create an EMPTY repo named '$REPO' on github.com, then run:"
  echo "  git branch -M main"
  echo "  git remote add origin https://github.com/<your-username>/$REPO.git"
  echo "  git push -u origin main"
fi

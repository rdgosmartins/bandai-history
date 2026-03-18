#!/usr/bin/env bash
# Deploy static files to Cloudflare Pages + auth worker (optional)
# Usage:
#   ./deploy.sh          — deploy static site only
#   ./deploy.sh --all    — deploy static site + auth worker

set -e

export NODE_TLS_REJECT_UNAUTHORIZED=0
export CLOUDFLARE_API_TOKEN=cfut_Spm1KjZfWOnXjpOekMmt7hJvHTSAkTCAG8eosU4k51986865

echo "🌐 Deploying static site to Cloudflare Pages..."
npx wrangler pages deploy . --project-name bandai-history --branch main --commit-dirty=true
echo "✅ Static site deployed!"

if [[ "$1" == "--all" ]]; then
    echo ""
    echo "⚙️  Deploying auth worker..."
    cd cloudflare
    npx wrangler deploy auth-worker.js --config auth-wrangler.toml
    cd ..
    echo "✅ Auth worker deployed!"
fi

echo ""
echo "🏴‍☠️ Done! https://bandai-history.pages.dev"

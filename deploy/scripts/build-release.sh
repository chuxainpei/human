#!/usr/bin/env bash
# Build a self-contained release tarball: apps/api/dist + prod node_modules, apps/web/dist, content/. Pure-JS deps (arch independent).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
npm run build >/dev/null
STAGE="$(mktemp -d)/human-$SHA"; mkdir -p "$STAGE/apps/api" "$STAGE/apps/web"
cp -r apps/api/dist "$STAGE/apps/api/"; cp -r apps/web/dist "$STAGE/apps/web/"; cp -r content "$STAGE/"
node -e "const p=require('./apps/api/package.json');delete p.devDependencies;p.scripts={start:'node dist/server.js'};require('fs').writeFileSync('$STAGE/apps/api/package.json',JSON.stringify(p,null,2))"
(cd "$STAGE/apps/api" && npm install --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null)
echo "$SHA" > "$STAGE/REVISION"
mkdir -p dist-release; tar -C "$(dirname "$STAGE")" -czf "dist-release/human-$SHA.tar.gz" "human-$SHA"
sha256sum "dist-release/human-$SHA.tar.gz" | tee "dist-release/human-$SHA.tar.gz.sha256"

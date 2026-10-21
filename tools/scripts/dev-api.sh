#!/usr/bin/env bash
# (Re)start the API locally in the background. Sandbox note: NODE_USE_ENV_PROXY lets Node fetch use the
# egress proxy that carries the model credential; TTS_DIRECT strips that proxy for the edge-tts child.
cd "$(dirname "$0")/../../apps/api"
if [ -f /tmp/human-api.pid ]; then kill "$(cat /tmp/human-api.pid)" 2>/dev/null; sleep 1; fi
NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1 TTS_DIRECT=1 PORT="${PORT:-8420}" SERVE_WEB="${SERVE_WEB:-0}" \
  nohup node --import tsx src/server.ts > /tmp/human-api.log 2>&1 &
echo $! > /tmp/human-api.pid
for i in $(seq 1 90); do curl -sf --noproxy '*' "localhost:${PORT:-8420}/human/api/health" >/dev/null && { echo "api up pid $(cat /tmp/human-api.pid)"; exit 0; }; sleep 0.5; done
echo "api failed to start"; tail -20 /tmp/human-api.log; exit 1

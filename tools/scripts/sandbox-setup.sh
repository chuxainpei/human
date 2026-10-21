#!/usr/bin/env bash
# Sandbox bootstrap (home dir is not persistent): edge-tts, Playwright ffmpeg, a CJK font for headless screenshots.
set -e
python3 -c "import edge_tts" 2>/dev/null || pip install -q edge-tts==7.3.1
python3 -c "import playwright" 2>/dev/null || pip install -q playwright==1.64.0
[ -x ~/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux ] || python3 -m playwright install ffmpeg >/dev/null
mkdir -p ~/.fonts; [ -f ~/.fonts/NotoSansSC.otf ] || cp /workspace/work/NotoSansSC.otf ~/.fonts/ ; fc-cache -f >/dev/null 2>&1 || true

command -v chromium >/dev/null || { sudo -n apt-get update -qq && sudo -n apt-get install -y -qq chromium fonts-noto-cjk >/dev/null; }
pip install -q numpy pillow >/dev/null 2>&1 || true
echo "sandbox ready"

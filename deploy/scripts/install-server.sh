#!/usr/bin/env bash
# Run as root on the server. Idempotent. Requires: RELEASE_TARBALL, RELEASE_SHA. Optional: NGINX_SITE (default /etc/nginx/sites-available/pkusi).
# Expects /etc/human/human.env to exist (created separately; contains the model key).
set -euo pipefail
: "${RELEASE_TARBALL:?}"; : "${RELEASE_SHA:?}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/pkusi}"; R=/var/www/human; TS=$(date +%Y%m%d%H%M%S)
id human >/dev/null 2>&1 || useradd --system --home /var/www/human --shell /usr/sbin/nologin human
mkdir -p $R/releases $R/backup /etc/human
# Python edge-tts in its own venv
if [ ! -x /opt/human/venv/bin/python ]; then apt-get install -y python3-venv >/dev/null 2>&1 || true; python3 -m venv /opt/human/venv; fi
/opt/human/venv/bin/pip install -q --upgrade "edge-tts==7.3.1"
tar -C $R/releases -xzf "$RELEASE_TARBALL"; mv -T $R/releases/human-$RELEASE_SHA $R/releases/$RELEASE_SHA 2>/dev/null || true
chown -R root:root $R/releases/$RELEASE_SHA; chmod -R a+rX $R/releases/$RELEASE_SHA
PREV=$(readlink $R/current || echo none)
ln -sfn $R/releases/$RELEASE_SHA $R/current
cp "$(dirname "$0")/human-api.service" /etc/systemd/system/human-api.service
cp "$NGINX_SITE" $R/backup/pkusi.$TS
cp "$(dirname "$0")/human.conf" /etc/nginx/snippets/human.conf
grep -q 'include /etc/nginx/snippets/human.conf;' "$NGINX_SITE" || sed -i '0,/location \/ {/s//include \/etc\/nginx\/snippets\/human.conf;\n    location \/ {/' "$NGINX_SITE"
if ! nginx -t; then cp $R/backup/pkusi.$TS "$NGINX_SITE"; rm -f /etc/nginx/snippets/human.conf; [ "$PREV" != none ] && ln -sfn "$PREV" $R/current; echo "NGINX TEST FAILED, restored"; exit 1; fi
systemctl daemon-reload; systemctl enable human-api >/dev/null 2>&1; systemctl restart human-api
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8318/human/api/health >/dev/null && break; sleep 1; done
systemctl reload nginx
echo "DEPLOYED $RELEASE_SHA at $TS (previous: $PREV)"
curl -s http://127.0.0.1:8318/human/api/health

#!/bin/sh
set -eu

export RECLINARR_PORT="${RECLINARR_PORT:-8787}"
export RECLINARR_API_PORT="${RECLINARR_API_PORT:-8788}"
export RECLINARR_DATA_DIR="${RECLINARR_DATA_DIR:-/data}"
export RECLINARR_MEDIA_PLANE=nginx
export RECLINARR_EMBED_PACKAGER=false
export RECLINARR_PORT_INTERNAL="$RECLINARR_API_PORT"

# Derive nginx upstreams from provider URLs (host:port only).
jellyfin_url="${JELLYFIN_URL:-http://127.0.0.1:8096}"
dispatcharr_url="${DISPATCHARR_URL:-http://127.0.0.1:9191}"

export JELLYFIN_UPSTREAM="$(printf '%s' "$jellyfin_url" | sed -E 's#/*$##')"
export DISPATCHARR_UPSTREAM="$(printf '%s' "$dispatcharr_url" | sed -E 's#/*$##')"
export JELLYFIN_HOST="$(printf '%s' "$JELLYFIN_UPSTREAM" | sed -E 's#^https?://##' | cut -d/ -f1)"
export DISPATCHARR_HOST="$(printf '%s' "$DISPATCHARR_UPSTREAM" | sed -E 's#^https?://##' | cut -d/ -f1)"
export DISPATCHARR_CF_ACCESS_CLIENT_ID="${DISPATCHARR_CF_ACCESS_CLIENT_ID:-}"
export DISPATCHARR_CF_ACCESS_CLIENT_SECRET="${DISPATCHARR_CF_ACCESS_CLIENT_SECRET:-}"

# empty CF headers must not break nginx — use a placeholder space
if [ -z "${DISPATCHARR_CF_ACCESS_CLIENT_ID}" ]; then
  export DISPATCHARR_CF_ACCESS_CLIENT_ID=""
fi

envsubst '${RECLINARR_PORT} ${RECLINARR_API_PORT} ${RECLINARR_DATA_DIR} ${JELLYFIN_UPSTREAM} ${JELLYFIN_HOST} ${DISPATCHARR_UPSTREAM} ${DISPATCHARR_HOST} ${DISPATCHARR_CF_ACCESS_CLIENT_ID} ${DISPATCHARR_CF_ACCESS_CLIENT_SECRET}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

# World-readable HLS so nginx `/_hls` X-Accel can serve segments if used.
# ffmpeg often creates 600 files as root; the nginx worker then 403s.
umask 022
mkdir -p "$RECLINARR_DATA_DIR/hls" /var/log/nginx /tmp
chmod -R a+rX "$RECLINARR_DATA_DIR/hls" 2>/dev/null || true

# API on loopback; nginx publishes RECLINARR_PORT.
RECLINARR_PORT="$RECLINARR_API_PORT" \
RECLINARR_MEDIA_PLANE=nginx \
RECLINARR_EMBED_PACKAGER=false \
  node /app/apps/api/dist/server.js &
API_PID=$!

RECLINARR_EMBED_PACKAGER=false \
  node /app/apps/api/dist/packager.js &
PACK_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

term() {
  kill -TERM "$API_PID" "$PACK_PID" "$NGINX_PID" 2>/dev/null || true
  wait || true
  exit 0
}
trap term INT TERM

# Exit if any child dies.
while kill -0 "$API_PID" 2>/dev/null \
  && kill -0 "$PACK_PID" 2>/dev/null \
  && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 2
done

echo "[entrypoint] a process exited; shutting down" >&2
term

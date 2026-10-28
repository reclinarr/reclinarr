#!/bin/sh
set -eu

export RECLINARR_PORT="${RECLINARR_PORT:-8787}"
export RECLINARR_API_PORT="${RECLINARR_API_PORT:-8788}"
export RECLINARR_DATA_DIR="${RECLINARR_DATA_DIR:-/data}"
export RECLINARR_MEDIA_PLANE=nginx
export RECLINARR_EMBED_PACKAGER=false
export RECLINARR_PORT_INTERNAL="$RECLINARR_API_PORT"

# Value saved by the setup wizard, used when the environment leaves it unset (same rule as the API).
setup_value() {
  node -e '
    const fs = require("fs");
    const [path, key] = process.argv.slice(1);
    if (fs.existsSync(path)) {
      const value = JSON.parse(fs.readFileSync(path, "utf8"))[key];
      if (typeof value === "string") process.stdout.write(value);
    }
  ' "$RECLINARR_DATA_DIR/config.json" "$1"
}

# Derive nginx upstreams from provider URLs (scheme://host:port only). A base path such as
# /jellyfin must not reach proxy_pass: with a URI there, nginx would drop the request path,
# and the API's X-Accel paths already include it.
jellyfin_url="${JELLYFIN_URL:-$(setup_value JELLYFIN_URL)}"
dispatcharr_url="${DISPATCHARR_URL:-$(setup_value DISPATCHARR_URL)}"
jellyfin_url="${jellyfin_url:-http://127.0.0.1:8096}"
dispatcharr_url="${dispatcharr_url:-http://127.0.0.1:9191}"

export JELLYFIN_UPSTREAM="$(printf '%s' "$jellyfin_url" | sed -E 's#^(https?://[^/]+).*#\1#')"
export DISPATCHARR_UPSTREAM="$(printf '%s' "$dispatcharr_url" | sed -E 's#^(https?://[^/]+).*#\1#')"

# These values are written into nginx.conf, and config.json is editable from the admin UI:
# accept only a bare scheme://host[:port] origin on a single line.
require_origin() {
  if [ "$(printf '%s' "$2" | wc -l)" -ne 0 ] \
    || ! printf '%s' "$2" | grep -Eqx 'https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?'; then
    echo "[entrypoint] $1 must be an http(s) address such as https://jellyfin.example.com" >&2
    exit 1
  fi
}
require_origin JELLYFIN_URL "$JELLYFIN_UPSTREAM"
require_origin DISPATCHARR_URL "$DISPATCHARR_UPSTREAM"

export JELLYFIN_HOST="$(printf '%s' "$JELLYFIN_UPSTREAM" | sed -E 's#^https?://##')"
export DISPATCHARR_HOST="$(printf '%s' "$DISPATCHARR_UPSTREAM" | sed -E 's#^https?://##')"
# Certificate checks need the bare host name: no port, no IPv6 brackets.
export JELLYFIN_TLS_NAME="$(printf '%s' "$JELLYFIN_HOST" | sed -E 's#:[0-9]+$##; s#^\[(.*)\]$#\1#')"
export DISPATCHARR_TLS_NAME="$(printf '%s' "$DISPATCHARR_HOST" | sed -E 's#:[0-9]+$##; s#^\[(.*)\]$#\1#')"

# nginx verifies https upstream certificates against the system CA bundle. Self-signed
# upstreams can opt out with RECLINARR_UPSTREAM_TLS_VERIFY=false.
case "${RECLINARR_UPSTREAM_TLS_VERIFY:-true}" in
  false|0) export UPSTREAM_TLS_VERIFY=off ;;
  *) export UPSTREAM_TLS_VERIFY=on ;;
esac
export DISPATCHARR_CF_ACCESS_CLIENT_ID="${DISPATCHARR_CF_ACCESS_CLIENT_ID:-}"
export DISPATCHARR_CF_ACCESS_CLIENT_SECRET="${DISPATCHARR_CF_ACCESS_CLIENT_SECRET:-}"

# nginx queries every listed resolver round-robin, so use only the container's own:
# Docker's embedded DNS on Compose networks, the host's resolvers on the default bridge.
export NGINX_RESOLVERS="$(awk '/^nameserver/ { ip = $2; if (ip ~ /:/) ip = "[" ip "]"; printf "%s ", ip }' /etc/resolv.conf)"

envsubst '${RECLINARR_PORT} ${RECLINARR_API_PORT} ${RECLINARR_DATA_DIR} ${NGINX_RESOLVERS} ${JELLYFIN_UPSTREAM} ${JELLYFIN_HOST} ${JELLYFIN_TLS_NAME} ${DISPATCHARR_UPSTREAM} ${DISPATCHARR_HOST} ${DISPATCHARR_TLS_NAME} ${UPSTREAM_TLS_VERIFY} ${DISPATCHARR_CF_ACCESS_CLIENT_ID} ${DISPATCHARR_CF_ACCESS_CLIENT_SECRET}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

# Library files must stay readable by Jellyfin, which runs under its own uid.
umask 022
mkdir -p "$RECLINARR_DATA_DIR/hls"

# PUID/PGID set the runtime user's ids, e.g. to match the owner of a host bind mount.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
case "$PUID$PGID" in
  *[!0-9]*) echo "[entrypoint] PUID and PGID must be numeric" >&2; exit 1 ;;
esac
# 0 would silently run the API, packager, nginx and ffmpeg as root.
if { [ "$PUID" = 0 ] || [ "$PGID" = 0 ]; } && [ "${RECLINARR_ALLOW_ROOT:-false}" != true ]; then
  echo "[entrypoint] PUID/PGID 0 runs everything as root; set RECLINARR_ALLOW_ROOT=true to allow it" >&2
  exit 1
fi
sed -i -E "s/^node:x:[0-9]+:[0-9]+:/node:x:$PUID:$PGID:/" /etc/passwd
sed -i -E "s/^node:x:[0-9]+:/node:x:$PGID:/" /etc/group
chown -R node:node /run/nginx /var/log/nginx /var/lib/nginx /home/node

# Hand the data volume to the runtime user when it is owned by root (images that ran as root)
# or by the image's default uid 1000 (before PUID changed). Any other owner is a host bind
# mount and is left alone.
data_owner="$(stat -c %u "$RECLINARR_DATA_DIR")"
if [ "$data_owner" != "$PUID" ] && { [ "$data_owner" = 0 ] || [ "$data_owner" = 1000 ]; }; then
  chown -R node:node "$RECLINARR_DATA_DIR"
fi

# Give the runtime user the host's group for each mounted GPU render node (gid varies by host).
for dev in /dev/dri/renderD*; do
  [ -e "$dev" ] || continue
  gid="$(stat -c %g "$dev")"
  [ "$gid" != 0 ] || continue
  group="$(awk -F: -v gid="$gid" '$3 == gid { print $1 }' /etc/group)"
  if [ -z "$group" ]; then
    group="render$gid"
    addgroup -g "$gid" "$group"
  fi
  id -nG node | tr ' ' '\n' | grep -qx "$group" || addgroup node "$group"
done

# Only call backgrounded: `&` forks a subshell, and exec (plus busybox su not forking) keeps
# $! pointing at the child itself so `term` can signal it.
# `--` stops su from parsing the child's flags (nginx -g) as its own.
as_node() {
  exec su -s /bin/sh -c 'exec "$0" "$@"' -- node "$@"
}

# API on loopback; nginx publishes RECLINARR_PORT.
# The API hands media to nginx only while its upstream matches what nginx was rendered with
# (an admin edit reloads the API in-process but nginx keeps these until the next start).
RECLINARR_PORT="$RECLINARR_API_PORT" \
RECLINARR_MEDIA_PLANE=nginx \
RECLINARR_EMBED_PACKAGER=false \
RECLINARR_NGINX_JELLYFIN_UPSTREAM="$JELLYFIN_UPSTREAM" \
RECLINARR_NGINX_DISPATCHARR_UPSTREAM="$DISPATCHARR_UPSTREAM" \
  as_node node /app/apps/api/dist/server.js &
API_PID=$!

RECLINARR_EMBED_PACKAGER=false \
  as_node node /app/apps/api/dist/packager.js &
PACK_PID=$!

as_node nginx -g 'daemon off;' &
NGINX_PID=$!

term() {
  kill -TERM "$API_PID" "$PACK_PID" "$NGINX_PID" 2>/dev/null || true
  wait || true
}
trap 'term; exit 0' INT TERM

# Exit if any child dies.
while kill -0 "$API_PID" 2>/dev/null \
  && kill -0 "$PACK_PID" 2>/dev/null \
  && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 2
done

echo "[entrypoint] a process exited; shutting down" >&2
term
exit 1

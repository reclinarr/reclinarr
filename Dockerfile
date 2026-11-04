# Build from repository root (required for `docker build <git-url>`).
#   docker build -t reclinarr https://github.com/reclinarr/reclinarr.git
#   docker compose -f docker/docker-compose.yml up -d --build

FROM node:26-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
# TV app is excluded from the image; stub the workspace so npm install succeeds.
RUN mkdir -p apps/tv && printf '%s\n' '{"name":"@reclinarr/tv","private":true,"version":"0.1.0"}' > apps/tv/package.json
RUN npm ci --no-audit --no-fund
RUN npm run build -w @reclinarr/shared
RUN npm run build -w @reclinarr/client
RUN npm run build -w @reclinarr/providers
RUN npm run bundle -w @reclinarr/api
RUN npm run build -w @reclinarr/web

FROM node:26-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# nginx (media plane) + envsubst + Jellyfin's ffmpeg build (HLS packager and live transcode).
# jellyfin-ffmpeg has NVENC, Quick Sync and VAAPI, with its own Intel/AMD drivers on amd64.
# It needs glibc, as do the NVENC libraries NVIDIA's container toolkit mounts in, which is
# why the image is Debian rather than Alpine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key -o /etc/apt/keyrings/jellyfin.asc \
  && printf '%s\n' 'Types: deb' 'URIs: https://repo.jellyfin.org/debian' 'Suites: trixie' \
       'Components: main' 'Signed-By: /etc/apt/keyrings/jellyfin.asc' \
       > /etc/apt/sources.list.d/jellyfin.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends nginx gettext-base jellyfin-ffmpeg7 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/nginx /var/log/nginx /var/lib/nginx \
  && rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

# The API and packager are single-file bundles; better-sqlite3 stays external because it
# loads a native binary from its own prebuilds/ directory.
COPY --from=build /app/apps/api/dist/bundle ./apps/api/dist/bundle
COPY --from=build /app/node_modules/better-sqlite3/package.json ./node_modules/better-sqlite3/package.json
COPY --from=build /app/node_modules/better-sqlite3/lib ./node_modules/better-sqlite3/lib
COPY --from=build /app/node_modules/better-sqlite3/prebuilds ./node_modules/better-sqlite3/prebuilds
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY docker/nginx/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/entrypoint.sh /entrypoint.sh
# The entrypoint starts as root to render nginx.conf and fix volume ownership, then runs
# the API, packager and nginx as `node`.
RUN chmod +x /entrypoint.sh && mkdir -p /data/hls \
  && chown -R node:node /data /run/nginx /var/log/nginx /var/lib/nginx

ARG RECLINARR_COMMIT
ENV RECLINARR_COMMIT=$RECLINARR_COMMIT
ENV RECLINARR_MEDIA_PLANE=nginx
ENV RECLINARR_EMBED_PACKAGER=false
ENV FFMPEG_PATH=/usr/lib/jellyfin-ffmpeg/ffmpeg
ENV FFPROBE_PATH=/usr/lib/jellyfin-ffmpeg/ffprobe
# `video` makes NVIDIA's container toolkit mount the NVENC libraries when a GPU is passed in.
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
EXPOSE 8787
CMD ["/entrypoint.sh"]

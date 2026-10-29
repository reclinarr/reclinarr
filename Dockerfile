# Build from repository root (required for `docker build <git-url>`).
#   docker build -t reclinarr https://github.com/reclinarr/reclinarr.git
#   docker compose -f docker/docker-compose.yml up -d --build

FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
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
RUN npm run build -w @reclinarr/api
RUN npm run build -w @reclinarr/web

# The install above also carries the web, mobile and TV toolchains; the runtime only needs
# the API's production dependencies.
FROM build AS deps
RUN npm ci --omit=dev --workspace=@reclinarr/api --no-audit --no-fund

FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# nginx (media plane) + ffmpeg/ffprobe (HLS packager) + envsubst.
# VAAPI userspace so live transcode can use an Intel/AMD GPU when /dev/dri is mounted.
# Both drivers are x86_64-only here: mesa's AMD driver pulls in ~200MB of LLVM, and AMD
# GPUs on arm64 hosts are rare enough that arm64 uses software encoding.
RUN apk add --no-cache nginx ffmpeg gettext-envsubst curl libva \
  && { apk add --no-cache libva-utils || echo "libva-utils unavailable"; } \
  && if [ "$(apk --print-arch)" = x86_64 ]; then \
       { apk add --no-cache mesa-va-gallium || echo "mesa-va-gallium unavailable"; } \
       && { apk add --no-cache intel-media-driver || echo "intel-media-driver unavailable"; }; \
     fi \
  && mkdir -p /run/nginx /var/log/nginx /var/lib/nginx/tmp \
  && rm -f /etc/nginx/http.d/default.conf /etc/nginx/conf.d/default.conf

COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
# Whole workspaces, not just dist/: npm nests deps that conflict with the root (zod 4 vs
# the Expo side's zod 3) in each workspace's own node_modules.
COPY --from=deps /app/packages/shared ./packages/shared
COPY --from=deps /app/packages/providers ./packages/providers
COPY --from=deps /app/apps/api ./apps/api
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
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
EXPOSE 8787
CMD ["/entrypoint.sh"]

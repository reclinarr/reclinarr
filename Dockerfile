# Build from repository root (required for `docker build <git-url>`).
#   docker build -t reclinarr https://github.com/fearlessfara/streamerr.git
#   docker compose -f docker/docker-compose.yml up -d --build

FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/with-expo-env.mjs ./scripts/with-expo-env.mjs
COPY tsconfig.base.json ./
# TV app is excluded from the image; stub the workspace so npm install succeeds.
RUN mkdir -p apps/tv && printf '%s\n' '{"name":"@reclinarr/tv","private":true,"version":"0.1.0"}' > apps/tv/package.json
RUN npm install
RUN npm run build -w @reclinarr/shared
RUN npm run build -w @reclinarr/client
RUN npm run build -w @reclinarr/providers
RUN npm run build -w @reclinarr/api
ARG EXPO_PUBLIC_POSTHOG_PROJECT_KEY
RUN npm run build -w @reclinarr/web

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# nginx (media plane) + ffmpeg/ffprobe (HLS packager) + gettext (envsubst)
RUN apk add --no-cache nginx ffmpeg gettext curl \
  && mkdir -p /run/nginx /var/log/nginx /var/lib/nginx/tmp \
  && rm -f /etc/nginx/http.d/default.conf /etc/nginx/conf.d/default.conf 2>/dev/null || true

COPY package.json package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY docker/nginx/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data/hls

ENV RECLINARR_MEDIA_PLANE=nginx
ENV RECLINARR_EMBED_PACKAGER=false
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
EXPOSE 8787
CMD ["/entrypoint.sh"]

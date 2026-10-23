# syntax=docker/dockerfile:1.7
# One image, several roles: `inkadra all` (default), `web`, `collab`, `worker`, `migrate`.

ARG NODE_VERSION=22.23

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /src

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@inkadra/server --filter=@inkadra/web
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @inkadra/server deploy --prod --legacy /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Inkadra" \
      org.opencontainers.image.description="Self-hosted boards for film and photography" \
      org.opencontainers.image.url="https://github.com/inkadra/inkadra" \
      org.opencontainers.image.source="https://github.com/inkadra/inkadra" \
      org.opencontainers.image.documentation="https://github.com/inkadra/inkadra/tree/main/docs/self-hosting" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
# Security updates published since the base image was built; tini reaps child processes (the
# worker will run ffmpeg) and forwards signals. npm, corepack and yarn are not needed at
# runtime: removing them shrinks the image and the list of packages a scanner reports.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    INKADRA_VERSION=${VERSION} \
    DATA_DIR=/data \
    TMPDIR=/data/tmp \
    PORT=3000 \
    COLLAB_PORT=3001
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/server/scripts/healthcheck.mjs ./healthcheck.mjs
COPY --from=build --chmod=755 /src/apps/server/scripts/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=build /src/apps/web/dist ./web
# Upload parts and worker scratch files can be large: keep them on the data volume, not in /tmp.
RUN mkdir -p /data/tmp && chown -R node:node /data
# Non-root by default. compose.yaml starts the entrypoint as root instead, so it can give a host
# folder mounted on /data to node before dropping to it.
USER node
VOLUME ["/data"]
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "/app/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["all"]

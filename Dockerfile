# syntax=docker/dockerfile:1.7
# One image, several roles: `inkadra all` (default), `web`, `collab`, `worker`, `migrate`.

ARG NODE_VERSION=22.22

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
      org.opencontainers.image.source="https://github.com/inkadra/inkadra" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
ENV NODE_ENV=production \
    INKADRA_VERSION=${VERSION} \
    DATA_DIR=/data \
    PORT=3000 \
    COLLAB_PORT=3001
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/app/dist/main.js"]
CMD ["all"]

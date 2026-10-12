# SyncSpace production image: the API serves the built web app and WebSockets on one port.
#   docker build -t syncspace .
#   docker compose --profile app up -d --build      (with the bundled MongoDB)

FROM node:22-alpine AS build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/sync-client/package.json packages/sync-client/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps/web apps/web
RUN npm run build -w @syncspace/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    SERVE_WEB=true
COPY package.json package-lock.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/sync-client/package.json packages/sync-client/
RUN npm ci --omit=dev --no-audit --no-fund -w @syncspace/server && npm cache clean --force
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "apps/server/src/index.js"]

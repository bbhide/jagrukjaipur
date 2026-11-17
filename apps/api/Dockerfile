# Build from the repository root:  docker build -f apps/api/Dockerfile -t jagruk-api .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @jj/api
COPY apps/api apps/api
RUN npm run build -w @jj/api && npm prune --omit=dev -w @jj/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY db db
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
# Migrations run as a one-off task (`node dist/scripts/migrate.js`) before each deploy, not at container start.
CMD ["node", "dist/server.js"]

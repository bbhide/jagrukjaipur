# Build from the repository root:  docker build -f apps/web/Dockerfile -t jagruk-web .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @jj/web
COPY apps/web apps/web
ARG PUBLIC_SITE_URL=https://jagrukjaipur.com
ARG PUBLIC_CLARITY_ID=
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL PUBLIC_CLARITY_ID=$PUBLIC_CLARITY_ID
RUN npm run build -w @jj/web && npm prune --omit=dev -w @jj/web

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY --from=build /repo/apps/web/package.json apps/web/
WORKDIR /repo/apps/web
USER node
EXPOSE 4321
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/favicon/favicon.ico >/dev/null || exit 1
CMD ["node", "dist/server/entry.mjs"]

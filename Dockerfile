FROM node:24.13.0-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:24.13.0-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="PPOps" \
  org.opencontainers.image.description="Self-hosted, view-only RAILGUN payment reconciler" \
  org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 8787
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=5m --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "--config", "/app/config/ppops.config.json"]

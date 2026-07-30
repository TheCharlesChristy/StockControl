# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6
ARG PNPM_VERSION=11.9.0
ARG APP_VERSION=0.0.0-dev
ARG BUILD_TIMESTAMP=unknown
ARG GIT_SHA=unknown
# Railway deploys each runtime as a separate service from this single
# multi-stage image. The service supplies RUNTIME_TARGET as a build-time
# variable (api, worker, or web); the default keeps local Docker builds
# backwards-compatible with the web image.
ARG RUNTIME_TARGET=web

FROM ${NODE_IMAGE} AS build

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /workspace

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM build AS api-package

RUN pnpm --filter @stockcontrol/api deploy --prod --legacy /runtime/api \
    && rm -rf /runtime/api/coverage /runtime/api/src /runtime/api/test \
    && find /runtime/api -maxdepth 1 -type f ! -name package.json -delete \
    && find /runtime/api -type f \( -name "*.d.ts" -o -name "*.d.ts.map" -o -name ".tsbuildinfo" \) -delete \
    && mkdir -p /runtime/api/apps /runtime/api/packages/platform \
    && ln -s .. /runtime/api/apps/api \
    && ln -s ../../node_modules/@stockcontrol/platform-database /runtime/api/packages/platform/database

FROM build AS worker-package

RUN pnpm --filter @stockcontrol/worker deploy --prod --legacy /runtime/worker \
    && rm -rf /runtime/worker/coverage /runtime/worker/src /runtime/worker/test \
    && find /runtime/worker -maxdepth 1 -type f ! -name package.json -delete \
    && find /runtime/worker -type f \( -name "*.d.ts" -o -name "*.d.ts.map" -o -name ".tsbuildinfo" \) -delete \
    && mkdir -p /runtime/worker/apps \
    && ln -s .. /runtime/worker/apps/worker

FROM ${NODE_IMAGE} AS api

ARG APP_VERSION
ARG BUILD_TIMESTAMP
ARG GIT_SHA
LABEL org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="StockControl API" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV APP_VERSION=${APP_VERSION}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
WORKDIR /app

COPY --from=api-package --chown=node:node /runtime/api /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "const port=process.env.PORT||'3000';fetch(`http://127.0.0.1:${port}/api/v1/health/ready`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/api/dist/main.js"]

FROM ${NODE_IMAGE} AS worker

ARG APP_VERSION
ARG BUILD_TIMESTAMP
ARG GIT_SHA
LABEL org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="StockControl Worker" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV APP_VERSION=${APP_VERSION}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
WORKDIR /app

COPY --from=worker-package --chown=node:node /runtime/worker /app

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "const port=process.env.WORKER_HEALTH_PORT||process.env.PORT||'3001';fetch(`http://127.0.0.1:${port}/health/ready`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/worker/dist/main.js"]

FROM ${NGINX_IMAGE} AS web

ARG APP_VERSION
ARG BUILD_TIMESTAMP
ARG GIT_SHA
LABEL org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="StockControl Web" \
      org.opencontainers.image.version="${APP_VERSION}"

COPY infra/ansible/files/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=5 \
  CMD ["wget", "-q", "-O", "-", "http://127.0.0.1:8080/health"]

CMD ["nginx", "-g", "daemon off;"]

FROM ${RUNTIME_TARGET} AS runtime

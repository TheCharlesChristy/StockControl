# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6
ARG PYTHON_IMAGE=python:3.12-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.8.17@sha256:e4644cb5bd56fdc2c5ea3ee0525d9d21eed1603bccd6a21f887a938be7e85be1
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
# Reviewed, pinned llama.cpp release tag (b10343) — the only "version" of
# recognition-fusion's inference engine that is not the moving HEAD of an
# upstream repository. Bump deliberately, not as a drive-by.
ARG LLAMA_CPP_COMMIT=e23e9440eb0c625c30d6c40266e9335071a4debc
ARG PNPM_VERSION=11.9.0
ARG APP_VERSION=0.1.0
ARG BUILD_TIMESTAMP=unknown
ARG RAILWAY_GIT_COMMIT_SHA=unknown
ARG GIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
# Railway deploys each runtime as a separate service from this single
# multi-stage image. The service supplies RUNTIME_TARGET as a build-time
# variable (api, worker, web, recognition-core, or recognition-fusion); the
# default keeps local Docker builds backwards-compatible with the web image.
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
    && mkdir -p /runtime/worker/apps /runtime/worker/packages/platform \
    && ln -s .. /runtime/worker/apps/worker \
    && ln -s ../../node_modules/@stockcontrol/platform-database /runtime/worker/packages/platform/database

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

ENV API_HOST=api.railway.internal \
    API_PORT=3000 \
    NGINX_ENVSUBST_FILTER="^(API_HOST|API_PORT|NGINX_RESOLVER)$"

COPY --chmod=755 infra/railway/15-stockcontrol-runtime.envsh /docker-entrypoint.d/15-stockcontrol-runtime.envsh
COPY infra/railway/web-nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=5 \
  CMD ["wget", "-q", "-O", "-", "http://127.0.0.1:8080/health"]

CMD ["nginx", "-g", "daemon off;"]

FROM ${UV_IMAGE} AS uv

FROM ${PYTHON_IMAGE} AS recognition-core-build

# libvips backs pyvips's native decode path; zxing-cpp and onnxruntime bundle
# their own native code and need nothing extra at build time. Package name
# varies by Debian release around the 64-bit time_t transition (libvips42 on
# bookworm, libvips42t64 from trixie onward) — try both rather than pin to
# one and break silently on the next base image bump.
RUN apt-get update \
    && (apt-get install --yes --no-install-recommends libvips42 \
        || apt-get install --yes --no-install-recommends libvips42t64) \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /usr/local/bin/

WORKDIR /app

# Dependencies first, cached independently of source changes: uv.lock pins
# every version, so this layer only invalidates when a dependency changes.
COPY services/recognition-core/pyproject.toml services/recognition-core/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY services/recognition-core/src ./src
RUN uv sync --frozen --no-dev

# Verifies every digest against the reviewed manifest. The runtime image below
# never downloads.
COPY services/recognition-core/scripts ./scripts
COPY models/manifest.lock.json ./models/manifest.lock.json
RUN uv run python scripts/fetch_models.py --manifest models/manifest.lock.json --output /models

FROM ${PYTHON_IMAGE} AS recognition-core

ARG APP_VERSION
ARG BUILD_TIMESTAMP
ARG GIT_SHA
LABEL org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="StockControl Recognition Core" \
      org.opencontainers.image.version="${APP_VERSION}"

RUN apt-get update \
    && (apt-get install --yes --no-install-recommends libvips42 \
        || apt-get install --yes --no-install-recommends libvips42t64) \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /app --shell /usr/sbin/nologin recognition

WORKDIR /app

COPY --from=recognition-core-build --chown=recognition:recognition /app/.venv /app/.venv
COPY --from=recognition-core-build --chown=recognition:recognition /app/src /app/src
COPY --from=recognition-core-build --chown=recognition:recognition /models /models
COPY --from=recognition-core-build --chown=recognition:recognition /app/models/manifest.lock.json /models/manifest.lock.json

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONPATH="/app/src" \
    RECOGNITION_CORE_MODEL_DIR=/models

USER recognition
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health/ready').read()"]

# Railway assigns PORT at deploy time; exec keeps uvicorn as PID 1 so it
# still receives SIGTERM directly for a clean shutdown.
CMD ["sh", "-c", "exec uvicorn recognition_core.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

FROM ${DEBIAN_IMAGE} AS recognition-fusion-build

ARG LLAMA_CPP_COMMIT

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
       ca-certificates cmake g++ git libssl-dev make ninja-build python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# A shallow, single-commit fetch of exactly the reviewed tag: fast, and
# there is no history here worth keeping once the checkout is verified.
RUN git init --quiet . \
    && git remote add origin https://github.com/ggml-org/llama.cpp.git \
    && git fetch --depth 1 origin "${LLAMA_CPP_COMMIT}" \
    && git checkout --quiet FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${LLAMA_CPP_COMMIT}" \
    && rm -rf .git

# CPU-only (the CUDA/Metal/Vulkan backends all default off) and portable
# across whatever CPU the Railway build and runtime hosts happen to be —
# GGML_NATIVE would otherwise bake in -march=native from the build machine,
# which the runtime machine is not guaranteed to match. The multimodal
# (mtmd/clip) support llama-server needs for the VLM call is linked in by
# tools/server's own CMakeLists.txt unconditionally, not an opt-in flag.
RUN cmake -B build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DGGML_NATIVE=OFF \
      -DLLAMA_CURL=OFF \
      -DLLAMA_BUILD_TESTS=OFF \
      -DLLAMA_BUILD_EXAMPLES=OFF \
    # Keep the build within the small local/Railway builder memory envelope;
    # llama.cpp's full multimodal server can otherwise make BuildKit disappear
    # under parallel compiler pressure.
    && cmake --build build --target llama-server --parallel 2

# Reuses recognition-core's fetch script: it is manifest-driven and has
# nothing recognition-core-specific in it, and models/manifest.lock.json
# already covers both services' weights in one reviewed file.
COPY services/recognition-core/scripts ./scripts
COPY models/manifest.lock.json ./models/manifest.lock.json
RUN python3 scripts/fetch_models.py --manifest models/manifest.lock.json --output /models

FROM ${DEBIAN_IMAGE} AS recognition-fusion

ARG APP_VERSION
ARG BUILD_TIMESTAMP
ARG GIT_SHA
LABEL org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="StockControl Recognition Fusion" \
      org.opencontainers.image.version="${APP_VERSION}"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgomp1 libssl3 wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /app --shell /usr/sbin/nologin fusion

WORKDIR /app

COPY --from=recognition-fusion-build --chown=fusion:fusion \
     /src/build/bin/llama-server /usr/local/bin/llama-server
COPY --from=recognition-fusion-build --chown=fusion:fusion \
     /src/build/bin/*.so* /usr/local/lib/
# Fusion needs only the VLM and projector. Keeping the OCR/embedding artefacts
# out of this image reduces its resident footprint and avoids copying unrelated
# model layers into the service.
#
# The aliases that used to sit here, symlinking a lfm2.5-vl-3b-q4-0 directory at
# the 1.6B files so a stale Railway variable kept resolving, are deliberately
# gone. They made the deployed path disagree with the deployed weights, which is
# precisely the confusion a pinned manifest exists to prevent. The runbook
# variables move with this change instead.
COPY --from=recognition-fusion-build --chown=fusion:fusion \
     /models/qwen3.5-0.8b-q8-0 /models/qwen3.5-0.8b-q8-0
COPY --from=recognition-fusion-build --chown=fusion:fusion \
     /src/models/manifest.lock.json /models/manifest.lock.json
COPY --chown=fusion:fusion --chmod=755 services/recognition-fusion/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh

ENV LD_LIBRARY_PATH=/usr/local/lib

USER fusion
EXPOSE 8000

# /health is the one endpoint llama-server never puts behind --api-key
# (specification section 16.3's "no outbound calls" is about egress; this
# probe is inbound, loopback-only, and carries no evidence of its own).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD ["sh", "-c", "wget -q -O - http://127.0.0.1:${PORT:-8000}/health"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]

FROM ${RUNTIME_TARGET} AS runtime

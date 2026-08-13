#!/bin/sh
# Fails fast and clearly when the image has not been given real model
# weights, rather than letting llama-server's own error (a bare "failed to
# load model") stand in for it. The image build fetches and verifies the
# reviewed manifest before these paths are copied into the runtime image —
# see docs/operations/railway-stock-capture.md.
set -eu

: "${PORT:=8000}"

require_file() {
  variable_name=$1
  value=$2
  if [ -z "${value}" ]; then
    echo "recognition-fusion: ${variable_name} is not set." >&2
    exit 1
  fi
  if [ ! -f "${value}" ]; then
    echo "recognition-fusion: ${variable_name} (${value}) does not exist." >&2
    exit 1
  fi
}

require_file RECOGNITION_FUSION_MODEL_PATH "${RECOGNITION_FUSION_MODEL_PATH:-}"
require_file RECOGNITION_FUSION_MMPROJ_PATH "${RECOGNITION_FUSION_MMPROJ_PATH:-}"

if [ -z "${RECOGNITION_FUSION_API_KEY:-}" ]; then
  echo "recognition-fusion: RECOGNITION_FUSION_API_KEY is not set." >&2
  exit 1
fi

# exec keeps llama-server as PID 1 so it still receives SIGTERM directly for
# a clean shutdown, matching the api/worker/recognition-core images.
exec llama-server \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --model "${RECOGNITION_FUSION_MODEL_PATH}" \
  --mmproj "${RECOGNITION_FUSION_MMPROJ_PATH}" \
  --ctx-size 4096 \
  --parallel 1 \
  --api-key "${RECOGNITION_FUSION_API_KEY}" \
  --no-webui \
  --no-slots

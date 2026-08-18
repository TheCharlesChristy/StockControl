#!/bin/sh
# Fails fast and clearly when the image has not been given real model
# weights, rather than letting llama-server's own error (a bare "failed to
# load model") stand in for it. The image build fetches and verifies the
# reviewed manifest before these paths are copied into the runtime image —
# see docs/operations/railway-stock-capture.md.
set -eu

: "${PORT:=8000}"
# llama.cpp divides the total KV context between parallel slots. Two 4,096
# token slots allow the worker to analyse two photographs concurrently while
# retaining the per-photo context budget used by the response contract.
: "${LLAMA_ARG_N_PARALLEL:=2}"
: "${LLAMA_ARG_CTX_SIZE:=8192}"

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

# The projector's token output per image is the dominant CPU prefill cost, and
# it scales with whatever resolution the user happened to photograph at rather
# than with anything this service controls. Left unset, llama.cpp uses the
# model's own default. Exposed here so a deployment can cap it without a
# rebuild, which is the one lever that meaningfully moves per-photo latency.
set --
if [ -n "${RECOGNITION_FUSION_IMAGE_MAX_TOKENS:-}" ]; then
  set -- --image-max-tokens "${RECOGNITION_FUSION_IMAGE_MAX_TOKENS}"
fi

# exec keeps llama-server as PID 1 so it still receives SIGTERM directly for
# a clean shutdown, matching the api/worker/recognition-core images.
#
# The three reasoning flags are not optional decoration. Qwen3.5 is a hybrid
# reasoning model whose chat template enables thinking by default; against this
# service's 256-token output cap a thinking pass consumes the entire budget and
# returns no JSON at all. That presents as a near-total schema-failure rate and
# reads like a model that cannot follow a schema, not like a missing flag, so it
# is an expensive thing to rediscover. --reasoning off sets the sampler state
# and the template's enable_thinking argument together; --reasoning-budget 0 is
# the backstop for a template that ignores the argument; --jinja is required for
# either to reach the template at all, because the legacy path takes no
# template arguments. Setting enable_thinking through --chat-template-kwargs is
# deprecated upstream and warns.
exec llama-server \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --model "${RECOGNITION_FUSION_MODEL_PATH}" \
  --mmproj "${RECOGNITION_FUSION_MMPROJ_PATH}" \
  --ctx-size "${LLAMA_ARG_CTX_SIZE}" \
  --parallel "${LLAMA_ARG_N_PARALLEL}" \
  --api-key "${RECOGNITION_FUSION_API_KEY}" \
  --jinja \
  --reasoning off \
  --reasoning-budget 0 \
  --no-webui \
  --no-slots \
  "$@"

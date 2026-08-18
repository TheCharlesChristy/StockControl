# Stock-capture model artefact reproduction

This file records how the checked-in manifest is resolved. The binary weights
remain outside Git and are fetched only during a controlled image build.

## Fetch and verification

The build command is:

```text
docker build --build-arg RUNTIME_TARGET=recognition-core -t stockcontrol-recognition-core:<tag> .
docker build --build-arg RUNTIME_TARGET=recognition-fusion -t stockcontrol-recognition-fusion:<tag> .
```

Both targets run the same `services/recognition-core/scripts/fetch_models.py`
with `models/manifest.lock.json`. For each file, the script resolves:

```text
https://huggingface.co/{repoId}/resolve/{revision}/{path}
```

It streams the response, computes SHA-256, rejects a mismatch, and only then
renames the temporary file into `/models/{id}/{path}`. The runtime images make
no model download request.

## Artefacts and preprocessing

- `pp-ocrv6-small-det`: the official PaddlePaddle ONNX export. No local export
  or quantisation command is applied. `inference.yml` is pinned beside it and
  supplies the official DB preprocessing/postprocessing parameters. The
  runtime applies BGR ImageNet normalisation, 32-pixel-aligned resize, DB
  threshold `0.2`, box threshold `0.45`, and unclip ratio `1.4`.
- `pp-ocrv6-small-rec`: the official PaddlePaddle ONNX export. No local export
  or quantisation command is applied. Its pinned `inference.yml` supplies the
  CTC character dictionary. The runtime uses the declared 48-pixel height and
  320-pixel padded width with the same BGR ImageNet normalisation.
- `nomic-embed-vision-v1.5-int8`: the official INT8 ONNX export. No local
  export or quantisation command is applied. Its pinned
  `preprocessor_config.json` supplies CLIP resize/centre-crop preprocessing;
  the runtime uses the declared 224x224 crop and mean/std values, then L2
  normalises the first visual token.
- `qwen3.5-0.8b-q8-0`: the Q8_0 GGUF and matching F16 projector from
  `unsloth/Qwen3.5-0.8B-GGUF`. No local quantisation or conversion is applied.
  The runtime is built from llama.cpp commit
  `e23e9440eb0c625c30d6c40266e9335071a4debc`. The image's default
  `--ctx-size 8192` is split across `--parallel 2` slots (see
  `services/recognition-fusion/docker-entrypoint.sh`), giving each of the two
  concurrently analysed photographs a 4,096-token budget.

  Unlike every other entry here, this is a community conversion rather than a
  first-party export. That is a decision, not an accident: no first-party GGUF
  of the Qwen3.5 small tier existed when the model was selected, and the
  Apache-2.0 licence was worth the trade against LFM2.5-VL's revenue threshold.
  What the pin still guarantees is byte-level reproducibility; what it cannot
  guarantee is that the publisher's quantisation matches what the model authors
  would have shipped. The revision is pinned by commit rather than tracking the
  default branch because that repository has re-uploaded projector files after
  publication, so a branch pin would move underneath the build.

  Qwen3.5 needs no llama.cpp bump. The pinned commit already registers the
  `qwen35` language architecture, and the vision side loads through the
  existing `qwen3vl_merger` projector type; neither the pinned commit nor
  upstream master defines a Qwen3.5-specific projector. If a future conversion
  declares one, the projector fails to load loudly rather than silently
  degrading.

  The service runs `--jinja --reasoning off --reasoning-budget 0`. Qwen3.5 is a
  hybrid reasoning model that thinks by default, and a thinking pass exhausts
  the 256-token output cap before any JSON is emitted.

The exact revisions, file digests, and licence strings are authoritative in
`manifest.lock.json`. Every pinned artefact is now Apache-2.0; the community
provenance of the fusion entry is recorded in `NOTICE.txt`.

## Promotion status

The Qwen3.5-0.8B choice is user-directed. It resolves the licence question on
its own, because Apache-2.0 carries no revenue threshold, but it settles
nothing about speed or accuracy: no latency, RSS, image-token or schema-
conformance figure has been measured for it on this workload. A consented customer evaluation set was not supplied, so
section 19/20 accuracy, latency, RSS-soak, customer pilot, and Railway-cost
gates remain unmeasured. This manifest proves reproducible artefact loading and
runtime smoke tests; it does not claim model promotion or production readiness.

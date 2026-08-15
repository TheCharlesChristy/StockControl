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
- `lfm2.5-vl-1.6b-q4-0`: the staging evaluation candidate from the official
  `LiquidAI/LFM2.5-VL-1.6B-GGUF` repository, using its Q4_0 GGUF and matching
  F16 projector. No local quantisation or conversion is applied. The runtime
  is built from llama.cpp commit
  `e23e9440eb0c625c30d6c40266e9335071a4debc`. The image's default
  `--ctx-size 8192` is split across `--parallel 2` slots (see
  `services/recognition-fusion/docker-entrypoint.sh`), giving each of the two
  concurrently analysed photographs the same 4,096-token budget as before.

The exact revisions, file digests, and licence strings are authoritative in
`manifest.lock.json`. The LFM Open License v1.0 is not Apache-2.0; its annual
revenue threshold and redistribution conditions are repeated in `NOTICE.txt`.

## Promotion status

The LFM choice is a user-directed staging experiment intended to measure
whether the smaller model meets the required latency without losing acceptable
recognition quality. A consented customer evaluation set was not supplied, so
section 19/20 accuracy, latency, RSS-soak, customer pilot, and Railway-cost
gates remain unmeasured. This manifest proves reproducible artefact loading and
runtime smoke tests; it does not claim model promotion or production readiness.

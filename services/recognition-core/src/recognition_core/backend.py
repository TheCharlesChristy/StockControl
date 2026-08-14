"""Weight-backed OCR and visual embedding implementations.

The model directory is populated only by the manifest-driven image build. The
HTTP routes depend on the small protocols below, so a missing or corrupt model
still degrades to the existing ``Unavailable`` stage rather than turning a
model-loading problem into catalogue state.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import onnxruntime as ort
from PIL import Image

from recognition_core.contracts import CategoryLabel, EmbeddingResult, OcrLine
from recognition_core.errors import ModelUnavailableError


class OcrBackend(Protocol):
    def recognise_text(self, pixels: np.ndarray) -> list[OcrLine]: ...


class EmbeddingBackend(Protocol):
    def embed_image(self, pixels: np.ndarray) -> EmbeddingResult: ...


class CategoryBackend(Protocol):
    def classify(self, embedding: EmbeddingResult) -> list[CategoryLabel]: ...


class _UnavailableOcrBackend:
    def recognise_text(self, pixels: np.ndarray) -> list[OcrLine]:
        del pixels
        raise ModelUnavailableError(
            "recognition.ocr_unavailable", "The text recognition model is not loaded."
        )


class _UnavailableEmbeddingBackend:
    def embed_image(self, pixels: np.ndarray) -> EmbeddingResult:
        del pixels
        raise ModelUnavailableError(
            "recognition.embedding_unavailable", "The image embedding model is not loaded."
        )


class _UnavailableCategoryBackend:
    def classify(self, embedding: EmbeddingResult) -> list[CategoryLabel]:
        del embedding
        # Category labels need catalogue/category text, which this stateless
        # service intentionally does not receive. The worker uses the same
        # embedding for visual-neighbour search, so this stage remains an
        # explicit partial-assist result rather than an invented label.
        raise ModelUnavailableError(
            "recognition.category_unavailable", "No category label set was provided."
        )


@dataclass(frozen=True)
class Backends:
    ocr: OcrBackend
    embedding: EmbeddingBackend
    category: CategoryBackend
    # OCR and visual embedding are loaded. Category matching is intentionally
    # optional because the service has no catalogue label vocabulary.
    all_loaded: bool


def _session(path: Path, intra_op_threads: int) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = intra_op_threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    return ort.InferenceSession(
        str(path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )


def _rgb_pixels(pixels: np.ndarray) -> np.ndarray:
    if pixels.ndim == 2:
        return np.repeat(pixels[..., None], 3, axis=2)
    if pixels.shape[2] == 4:
        return pixels[..., :3]
    if pixels.shape[2] == 3:
        return pixels
    raise ValueError("unsupported pixel shape")


def _resize(array: np.ndarray, width: int, height: int) -> np.ndarray:
    image = Image.fromarray(np.ascontiguousarray(array), mode="RGB")
    return np.asarray(image.resize((width, height), Image.Resampling.BILINEAR), dtype=np.uint8)


def _normalise_paddle(array: np.ndarray) -> np.ndarray:
    # The official Paddle metadata declares BGR input and HWC ImageNet
    # normalisation. The HTTP decoder exposes RGB, so convert at this seam.
    bgr = _rgb_pixels(array)[..., ::-1].astype(np.float32) / 255.0
    mean = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
    return ((bgr - mean) / std).transpose(2, 0, 1)[None, ...].astype(np.float32)


def _normalise_clip(array: np.ndarray) -> np.ndarray:
    rgb = _rgb_pixels(array).astype(np.float32) / 255.0
    mean = np.asarray([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
    std = np.asarray([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
    return ((rgb - mean) / std).transpose(2, 0, 1)[None, ...].astype(np.float32)


def _clip_preprocess(pixels: np.ndarray) -> np.ndarray:
    rgb = _rgb_pixels(pixels)
    height, width = rgb.shape[:2]
    scale = 224.0 / min(height, width)
    resized = _resize(rgb, max(224, round(width * scale)), max(224, round(height * scale)))
    top = (resized.shape[0] - 224) // 2
    left = (resized.shape[1] - 224) // 2
    return _normalise_clip(resized[top : top + 224, left : left + 224])


def _parse_yaml_scalar(value: str) -> str:
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1].replace("''", "'")
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return str(json.loads(value))
    return value


def _load_character_dictionary(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    try:
        start = lines.index("  character_dict:") + 1
    except ValueError as error:
        raise ValueError("OCR recognition metadata has no character dictionary") from error

    result: list[str] = []
    for line in lines[start:]:
        if not line.startswith("  - "):
            break
        result.append(_parse_yaml_scalar(line[4:]))
    if not result:
        raise ValueError("OCR recognition character dictionary is empty")
    return result


def _detector_input(pixels: np.ndarray) -> tuple[np.ndarray, float, float]:
    rgb = _rgb_pixels(pixels)
    height, width = rgb.shape[:2]
    scale = min(1.0, 960.0 / max(height, width))
    resized_height = max(32, math.ceil(height * scale / 32) * 32)
    resized_width = max(32, math.ceil(width * scale / 32) * 32)
    resized = _resize(rgb, resized_width, resized_height)
    return _normalise_paddle(resized), resized_width / width, resized_height / height


def _connected_boxes(probability: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    mask = probability > 0.2
    visited = np.zeros(mask.shape, dtype=bool)
    height, width = mask.shape
    candidates: list[tuple[int, int, int, int, float]] = []

    for y, x in zip(*np.nonzero(mask), strict=True):
        if visited[y, x]:
            continue
        stack = [(int(y), int(x))]
        visited[y, x] = True
        min_x = max_x = int(x)
        min_y = max_y = int(y)
        area = 0
        score_total = 0.0
        while stack:
            current_y, current_x = stack.pop()
            area += 1
            score_total += float(probability[current_y, current_x])
            min_x = min(min_x, current_x)
            max_x = max(max_x, current_x)
            min_y = min(min_y, current_y)
            max_y = max(max_y, current_y)
            for next_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                for next_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                    if mask[next_y, next_x] and not visited[next_y, next_x]:
                        visited[next_y, next_x] = True
                        stack.append((next_y, next_x))

        score = score_total / area
        if area < 3 or score < 0.45:
            continue
        candidates.append((min_x, min_y, max_x + 1, max_y + 1, score))

    # The official DB post-process expands text regions before recognition. A
    # rectangle expansion is deliberately conservative here; it preserves the
    # service contract without introducing a new native geometry dependency.
    expanded: list[tuple[int, int, int, int, float]] = []
    for x0, y0, x1, y1, score in candidates[:3000]:
        extra_x = max(1, round((x1 - x0) * 0.2))
        extra_y = max(1, round((y1 - y0) * 0.2))
        expanded.append((x0 - extra_x, y0 - extra_y, x1 + extra_x, y1 + extra_y, score))
    return expanded


def _box_in_original(
    box: tuple[int, int, int, int, float], scale_x: float, scale_y: float, width: int, height: int
) -> tuple[int, int, int, int, float]:
    x0, y0, x1, y1, score = box
    return (
        max(0, min(width - 1, round(x0 / scale_x))),
        max(0, min(height - 1, round(y0 / scale_y))),
        max(1, min(width, round(x1 / scale_x))),
        max(1, min(height, round(y1 / scale_y))),
        score,
    )


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - values.max(axis=-1, keepdims=True)
    exponent = np.exp(shifted)
    return np.asarray(exponent / exponent.sum(axis=-1, keepdims=True), dtype=np.float32)


def _ctc_decode(output: np.ndarray, dictionary: list[str]) -> tuple[str, float]:
    logits = np.asarray(output[0], dtype=np.float32)
    if logits.ndim != 2:
        raise ValueError("unexpected OCR recognition output rank")
    if logits.shape[0] < logits.shape[1] and logits.shape[0] in {
        len(dictionary),
        len(dictionary) + 1,
        len(dictionary) + 2,
    }:
        logits = logits.transpose(1, 0)
    probabilities = (
        logits
        if np.all(logits >= 0.0)
        and np.all(logits <= 1.0)
        and np.allclose(logits.sum(axis=-1), 1.0, atol=1e-3)
        else _softmax(logits)
    )
    indices = probabilities.argmax(axis=-1)
    confidence = probabilities.max(axis=-1)
    characters = [""] + dictionary
    if len(characters) + 1 == probabilities.shape[-1]:
        characters.append(" ")
    previous = -1
    text: list[str] = []
    scores: list[float] = []
    for index, score in zip(indices.tolist(), confidence.tolist(), strict=True):
        if index == 0 or index == previous:
            previous = index
            continue
        previous = index
        if index < len(characters):
            text.append(characters[index])
            scores.append(float(score))
    return "".join(text), float(np.mean(scores)) if scores else 0.0


class _OnnxOcrBackend:
    def __init__(self, model_directory: Path, intra_op_threads: int) -> None:
        root = model_directory / "pp-ocrv6-small-det"
        rec_root = model_directory / "pp-ocrv6-small-rec"
        self._detector = _session(root / "inference.onnx", intra_op_threads)
        self._recogniser = _session(rec_root / "inference.onnx", intra_op_threads)
        self._dictionary = _load_character_dictionary(rec_root / "inference.yml")

    def recognise_text(self, pixels: np.ndarray) -> list[OcrLine]:
        try:
            return self._recognise_text(pixels)
        except ModelUnavailableError:
            raise
        except Exception as error:
            raise ModelUnavailableError(
                "recognition.ocr_failed", "The OCR model could not analyse the image."
            ) from error

    def _recognise_text(self, pixels: np.ndarray) -> list[OcrLine]:
        input_image, scale_x, scale_y = _detector_input(pixels)
        detector_output = self._detector.run(
            None, {self._detector.get_inputs()[0].name: input_image}
        )[0]
        probability = np.asarray(
            detector_output[0, 0] if detector_output.ndim == 4 else detector_output[0]
        )
        height, width = pixels.shape[:2]
        boxes = [
            _box_in_original(box, scale_x, scale_y, width, height)
            for box in _connected_boxes(probability)
        ]
        boxes.sort(key=lambda box: (box[1], box[0]))
        results: list[OcrLine] = []
        for x0, y0, x1, y1, detection_score in boxes[:64]:
            if x1 <= x0 or y1 <= y0:
                continue
            crop = _rgb_pixels(pixels)[y0:y1, x0:x1]
            crop_height, crop_width = crop.shape[:2]
            resized_width = min(320, max(1, math.ceil(48 * crop_width / crop_height)))
            resized = _resize(crop, resized_width, 48)
            padded = np.zeros((48, 320, 3), dtype=np.uint8)
            padded[:, :resized_width] = resized
            recognition_output = self._recogniser.run(
                None,
                {self._recogniser.get_inputs()[0].name: _normalise_paddle(padded)},
            )[0]
            text, recognition_score = _ctc_decode(recognition_output, self._dictionary)
            text = text.strip()
            if not text:
                continue
            results.append(
                OcrLine(
                    text=text[:200],
                    score=max(0.0, min(1.0, min(detection_score, recognition_score))),
                    polygon=[
                        (x0 / width, y0 / height),
                        (x1 / width, y0 / height),
                        (x1 / width, y1 / height),
                        (x0 / width, y1 / height),
                    ],
                )
            )
        return results


class _OnnxEmbeddingBackend:
    model_revision = "nomic-embed-vision-v1.5@e3a725bce72db07ca4adb1d83da08903f3ee02f8"

    def __init__(self, model_directory: Path, intra_op_threads: int) -> None:
        self._session = _session(
            model_directory / "nomic-embed-vision-v1.5-int8" / "onnx" / "model_int8.onnx",
            intra_op_threads,
        )

    def embed_image(self, pixels: np.ndarray) -> EmbeddingResult:
        try:
            output = self._session.run(
                None,
                {self._session.get_inputs()[0].name: _clip_preprocess(pixels)},
            )[0]
            vector = np.asarray(output[0, 0], dtype=np.float32)
            norm = float(np.linalg.norm(vector))
            if norm == 0.0 or not np.isfinite(norm):
                raise ValueError("embedding output was not finite")
            vector = vector / norm
            return EmbeddingResult(
                model_revision=self.model_revision,
                vector=[float(value) for value in vector.tolist()],
            )
        except ModelUnavailableError:
            raise
        except Exception as error:
            raise ModelUnavailableError(
                "recognition.embedding_failed",
                "The image embedding model could not analyse the image.",
            ) from error


def load_backends(model_directory: str, intra_op_threads: int = 4) -> Backends:
    root = Path(model_directory)
    try:
        ocr = _OnnxOcrBackend(root, intra_op_threads)
        embedding = _OnnxEmbeddingBackend(root, intra_op_threads)
    except Exception as error:  # noqa: BLE001
        # Startup remains useful in Path A/manual mode when model files are not
        # present; readiness stays 503 and each stage reports Unavailable.
        #
        # Deliberately broad, and it has to be. onnxruntime raises its own
        # types — NoSuchFile, InvalidProtobuf, Fail — and every one of them
        # derives straight from Exception rather than from OSError or
        # RuntimeError. Naming base classes here therefore caught nothing in
        # the most ordinary case of all, a deployment with no weights: the
        # service died on load instead of degrading, which is the exact
        # opposite of what this fallback exists to do.
        del error
        return Backends(
            ocr=_UnavailableOcrBackend(),
            embedding=_UnavailableEmbeddingBackend(),
            category=_UnavailableCategoryBackend(),
            all_loaded=False,
        )
    return Backends(
        ocr=ocr,
        embedding=embedding,
        category=_UnavailableCategoryBackend(),
        all_loaded=True,
    )

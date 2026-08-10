/*
 * Stage 3, specification section 7.6: nearest-neighbour retrieval, not live
 * fine-tuning. Adding pgvector is deferred until either 50,000 active
 * exemplars or a measured p95 retrieval over 100ms — neither is justified for
 * the first release, so this is a bounded in-memory linear scan.
 *
 * Loading the index itself lives in visual-index-store.ts, not here: that
 * half needs a real PostgreSQL to mean anything, and is proved by
 * test/visual-index.integration.spec.ts rather than by mocking a query
 * builder. Everything in this file is pure and unit-tested directly.
 */

export interface VisualExample {
  readonly itemId: string;
  readonly vector: Float32Array;
}

export interface VisualNeighbour {
  readonly itemId: string;
  readonly similarity: number;
}

/**
 * Half-precision (IEEE 754 binary16) decode. Embeddings are stored as
 * versioned float16 `bytea` — full precision is not needed for a cosine
 * comparison and halves the bytes held in memory for the whole index.
 */
const decodeFloat16 = (half: number): number => {
  const sign = (half & 0x8000) !== 0 ? -1 : 1;
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x3ff;

  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction !== 0 ? Number.NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
};

/** Numpy's `.tobytes()` uses the platform's native order, little-endian on
 * every architecture this pipeline deploys to. Exported for
 * visual-index-store.ts, the only other caller. */
export const decodeFloat16Buffer = (buffer: Buffer): Float32Array => {
  const count = Math.floor(buffer.length / 2);
  const vector = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    vector[index] = decodeFloat16(buffer.readUInt16LE(index * 2));
  }
  return vector;
};

/**
 * The inverse of `decodeFloat16`, round-to-nearest. A comparison embedding
 * does not need better than half-precision, which is the entire reason it is
 * stored this way rather than as `float32`.
 */
const encodeFloat16 = (value: number): number => {
  if (Number.isNaN(value)) return 0x7e00;

  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const absolute = Math.abs(value);

  if (absolute === 0) return sign;
  if (!Number.isFinite(absolute) || absolute >= 65_520) return sign | 0x7c00;

  const exponent = Math.floor(Math.log2(absolute));

  // Subnormal: below the smallest normal exponent, there is no implicit
  // leading 1, so the whole value is carried in the fraction bits.
  if (exponent < -14) {
    return sign | (Math.round(absolute / 2 ** -24) & 0x3ff);
  }

  let fraction = Math.round((absolute / 2 ** exponent - 1) * 1024);
  let normalisedExponent = exponent;
  if (fraction === 1024) {
    // The rounding carry this reverses can reach exponent 15 (from 14) but
    // never past it: the guard above already routes anything within
    // rounding distance of overflowing exponent 15 itself to infinity.
    fraction = 0;
    normalisedExponent += 1;
  }

  return sign | ((normalisedExponent + 15) << 10) | fraction;
};

/** Encodes a query vector the same way `decodeFloat16Buffer` reads one back,
 * so a newly built exemplar's embedding is comparable to every other. */
export const encodeFloat16Buffer = (vector: Float32Array | readonly number[]): Buffer => {
  const buffer = Buffer.alloc(vector.length * 2);
  for (let index = 0; index < vector.length; index += 1) {
    // index is within [0, vector.length) by construction of the loop bound.
    buffer.writeUInt16LE(encodeFloat16(vector[index]!), index * 2);
  }
  return buffer;
};

export const cosineSimilarity = (left: Float32Array, right: Float32Array): number => {
  if (left.length !== right.length || left.length === 0) return 0;

  let dot = 0;
  let leftNormSquared = 0;
  let rightNormSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    // index < left.length === right.length here, so both reads are in bounds.
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftNormSquared += leftValue * leftValue;
    rightNormSquared += rightValue * rightValue;
  }

  if (leftNormSquared === 0 || rightNormSquared === 0) return 0;
  return dot / (Math.sqrt(leftNormSquared) * Math.sqrt(rightNormSquared));
};

/** Top-N neighbours by cosine similarity, highest first. Ties keep index order. */
export const findNearestNeighbours = (
  query: Float32Array,
  index: readonly VisualExample[],
  limit: number,
): readonly VisualNeighbour[] =>
  index
    .map((example): VisualNeighbour => ({
      itemId: example.itemId,
      similarity: cosineSimilarity(query, example.vector),
    }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit);

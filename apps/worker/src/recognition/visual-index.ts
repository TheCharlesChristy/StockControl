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

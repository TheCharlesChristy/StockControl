import { describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  decodeFloat16Buffer,
  findNearestNeighbours,
  type VisualExample,
} from "../src/recognition/visual-index";

/** Encodes a JS number as an IEEE-754 half-precision little-endian buffer,
 * mirroring what numpy's float16 `.tobytes()` produces — used only to build
 * fixtures for the tests below, never in the module under test. */
const encodeFloat16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  const sign = value < 0 ? 1 : 0;
  const absolute = Math.abs(value);

  if (absolute === 0) {
    buffer.writeUInt16LE(sign << 15, 0);
    return buffer;
  }

  const exponent = Math.floor(Math.log2(absolute));
  const normalisedExponent = exponent + 15;
  const fraction = Math.round((absolute / 2 ** exponent - 1) * 1024);
  buffer.writeUInt16LE((sign << 15) | (normalisedExponent << 10) | (fraction & 0x3ff), 0);
  return buffer;
};

const encodeVector = (values: readonly number[]): Buffer =>
  Buffer.concat(values.map(encodeFloat16));

describe("decodeFloat16Buffer", () => {
  it("round-trips ordinary values within half-precision tolerance", () => {
    const decoded = decodeFloat16Buffer(encodeVector([1, -1, 0.5, 2.5, 0]));

    expect(decoded[0]).toBeCloseTo(1, 2);
    expect(decoded[1]).toBeCloseTo(-1, 2);
    expect(decoded[2]).toBeCloseTo(0.5, 2);
    expect(decoded[3]).toBeCloseTo(2.5, 2);
    expect(decoded[4]).toBeCloseTo(0, 2);
  });

  it("decodes the half-precision infinity and NaN bit patterns", () => {
    const buffer = Buffer.alloc(6);
    buffer.writeUInt16LE(0x7c00, 0); // +infinity: exponent all-ones, zero fraction
    buffer.writeUInt16LE(0xfc00, 2); // -infinity: sign bit set
    buffer.writeUInt16LE(0x7c01, 4); // NaN: exponent all-ones, non-zero fraction

    const decoded = decodeFloat16Buffer(buffer);

    expect(decoded[0]).toBe(Infinity);
    expect(decoded[1]).toBe(-Infinity);
    expect(Number.isNaN(decoded[2])).toBe(true);
  });

  it("returns a vector with one entry per two bytes", () => {
    const decoded = decodeFloat16Buffer(encodeVector([1, 2, 3, 4]));

    expect(decoded).toHaveLength(4);
  });

  it("returns an empty vector for empty input", () => {
    expect(decodeFloat16Buffer(Buffer.alloc(0))).toHaveLength(0);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    const vector = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1, 5);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 5);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(
      -1,
      5,
    );
  });

  it("is 0 for a zero-magnitude vector rather than dividing by zero", () => {
    const result = cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]));
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(0);
  });

  it("is 0 for mismatched lengths rather than throwing", () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
  });
});

describe("findNearestNeighbours", () => {
  const example = (itemId: string, vector: readonly number[]): VisualExample => ({
    itemId,
    vector: new Float32Array(vector),
  });

  it("orders by similarity, highest first", () => {
    const index = [
      example("far", [0, 1]),
      example("close", [0.99, 0.14]),
      example("exact", [1, 0]),
    ];

    const neighbours = findNearestNeighbours(new Float32Array([1, 0]), index, 5);

    expect(neighbours.map((neighbour) => neighbour.itemId)).toEqual(["exact", "close", "far"]);
  });

  it("caps the result at the requested limit", () => {
    const index = [example("a", [1, 0]), example("b", [1, 0]), example("c", [1, 0])];

    expect(findNearestNeighbours(new Float32Array([1, 0]), index, 2)).toHaveLength(2);
  });

  it("returns an empty list for an empty index", () => {
    expect(findNearestNeighbours(new Float32Array([1, 0]), [], 5)).toEqual([]);
  });
});

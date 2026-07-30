import { describe, expect, it, vi } from "vitest";

import {
  NodeCryptoArgon2idDeriver,
  NodeRandomSource,
  SystemClock,
  type NodeArgon2,
} from "../src/node-adapters.js";

const parameters = {
  message: Buffer.from("password"),
  nonce: new Uint8Array(16),
  memoryKiB: 64,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;

describe("Node security adapters", () => {
  it("reads the system clock", () => {
    const before = Date.now();
    const result = new SystemClock().now();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("uses Node's cryptographic random source and validates requested lengths", () => {
    const source = new NodeRandomSource();
    const first = source.bytes(32);
    const second = source.bytes(32);
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
    expect(() => source.bytes(0)).toThrow(RangeError);
    expect(() => source.bytes(1.5)).toThrow(RangeError);
  });

  it("maps the derivation port to Node Argon2id", async () => {
    const implementation = vi.fn<NodeArgon2>((algorithm, received, callback) => {
      expect(algorithm).toBe("argon2id");
      expect(received).toMatchObject({
        message: parameters.message,
        nonce: parameters.nonce,
        memory: 64,
        passes: 2,
        parallelism: 1,
        tagLength: 32,
      });
      callback(null, Buffer.alloc(32, 7));
    });
    const result = await new NodeCryptoArgon2idDeriver(implementation).derive(parameters);
    expect(result).toEqual(new Uint8Array(32).fill(7));
    expect(implementation).toHaveBeenCalledOnce();
  });

  it("propagates asynchronous and synchronous adapter failures", async () => {
    const asyncFailure = new Error("async failure");
    const callbackFailure: NodeArgon2 = (_algorithm, _parameters, callback) => {
      callback(asyncFailure, Buffer.alloc(0));
    };
    await expect(new NodeCryptoArgon2idDeriver(callbackFailure).derive(parameters)).rejects.toBe(
      asyncFailure,
    );

    const syncFailure = new Error("sync failure");
    const throwing: NodeArgon2 = () => {
      throw syncFailure;
    };
    await expect(new NodeCryptoArgon2idDeriver(throwing).derive(parameters)).rejects.toBe(
      syncFailure,
    );
  });

  it("derives with the real Node 24+ Argon2id implementation", async () => {
    const result = await new NodeCryptoArgon2idDeriver().derive(parameters);
    expect(result).toHaveLength(32);
    await expect(new NodeCryptoArgon2idDeriver().derive(parameters)).resolves.toEqual(result);
  });
});

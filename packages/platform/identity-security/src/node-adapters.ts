import { argon2, randomBytes, type Argon2Parameters } from "node:crypto";

import type { Argon2idDerivation, Argon2idDeriver, Clock, RandomSource } from "./ports.js";

export type NodeArgon2 = (
  algorithm: "argon2id",
  parameters: Argon2Parameters,
  callback: (error: Error | null, derivedKey: Buffer) => void,
) => void;

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class NodeRandomSource implements RandomSource {
  public bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 1) {
      throw new RangeError("Random byte length must be a positive safe integer.");
    }
    return new Uint8Array(randomBytes(length));
  }
}

export class NodeCryptoArgon2idDeriver implements Argon2idDeriver {
  public constructor(private readonly implementation: NodeArgon2 = argon2) {}

  public async derive(parameters: Argon2idDerivation): Promise<Uint8Array> {
    return await new Promise<Uint8Array>((resolve, reject) => {
      this.implementation(
        "argon2id",
        {
          message: parameters.message,
          nonce: parameters.nonce,
          parallelism: parameters.parallelism,
          tagLength: parameters.tagLength,
          memory: parameters.memoryKiB,
          passes: parameters.passes,
        },
        (error, derivedKey) => {
          if (error !== null) {
            reject(error);
            return;
          }
          resolve(new Uint8Array(derivedKey));
        },
      );
    });
  }
}

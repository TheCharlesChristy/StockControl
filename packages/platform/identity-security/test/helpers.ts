import { createHash } from "node:crypto";

import type { Argon2idDerivation, Argon2idDeriver, Clock, RandomSource } from "../src/index.js";

export class IncrementingRandomSource implements RandomSource {
  public calls = 0;

  public bytes(length: number): Uint8Array {
    const start = this.calls++;
    return Uint8Array.from({ length }, (_, index) => (start + index) & 255);
  }
}

export class FixedRandomSource implements RandomSource {
  public constructor(private readonly value: Uint8Array) {}

  public bytes(): Uint8Array {
    return new Uint8Array(this.value);
  }
}

export class FixedClock implements Clock {
  public constructor(public date: Date) {}

  public now(): Date {
    return new Date(this.date);
  }
}

export class DeterministicArgon2idDeriver implements Argon2idDeriver {
  public readonly calls: Argon2idDerivation[] = [];

  public derive(parameters: Argon2idDerivation): Promise<Uint8Array> {
    this.calls.push(parameters);
    const first = createHash("sha512")
      .update(parameters.message)
      .update(parameters.nonce)
      .update(
        `${parameters.memoryKiB}:${parameters.passes}:${parameters.parallelism}:${parameters.tagLength}`,
      )
      .digest();
    return Promise.resolve(new Uint8Array(first.subarray(0, parameters.tagLength)));
  }
}

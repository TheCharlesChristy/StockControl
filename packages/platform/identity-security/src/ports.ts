export interface Clock {
  now(): Date;
}

export interface RandomSource {
  bytes(length: number): Uint8Array;
}

export interface Argon2idDerivation {
  readonly message: Uint8Array;
  readonly nonce: Uint8Array;
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly tagLength: number;
}

export interface Argon2idDeriver {
  derive(parameters: Argon2idDerivation): Promise<Uint8Array>;
}

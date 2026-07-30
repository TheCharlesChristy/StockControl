/**
 * A deterministic, dependency-free digest used only by test fakes.
 *
 * It is deliberately not a cryptographic hash: fakes prove orchestration,
 * binding, and single-use behavior, while real cryptography is proven against
 * the production adapters in `@stockcontrol/platform-identity-security`.
 */
const OFFSET_BASIS = 0xcbf2_9ce4_8422_2325n;
const PRIME = 0x0000_0100_0000_01b3n;
const MASK = 0xffff_ffff_ffff_ffffn;

const fnv1a = (input: string, seed: bigint): bigint => {
  let hash = (OFFSET_BASIS ^ seed) & MASK;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash ^ BigInt(input.charCodeAt(index))) & MASK;
    hash = (hash * PRIME) & MASK;
  }

  return hash;
};

export const deterministicDigest = (...parts: readonly string[]): Uint8Array => {
  const input = parts.map((part) => `${String(part.length)}:${part}`).join("|");
  const digest = new Uint8Array(32);

  for (let block = 0; block < 4; block += 1) {
    let value = fnv1a(input, BigInt(block));

    for (let byte = 0; byte < 8; byte += 1) {
      digest[block * 8 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  }

  return digest;
};

export const digestToText = (digest: Uint8Array): string =>
  [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");

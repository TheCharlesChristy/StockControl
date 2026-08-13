/*
 * Specification section 12. The server deduplicates a command by its client id
 * plus a hash of what was sent: the same id with the same payload returns the
 * original result, the same id with a different payload is a 409.
 *
 * A key minted fresh at each attempt satisfies neither half of that. Press
 * Confirm, lose the response to a dropped connection, press it again, and the
 * second request carries a new id — so the server has no way to recognise it
 * as the same intent, and the stockroom ends up with two receipts for one
 * delivery. The rule that makes it work is the mirror of the server's own:
 * hold the key for as long as the payload is unchanged, mint a new one the
 * moment it changes.
 */

export interface IdempotencyKeeper {
  /** The same key while `payload` is unchanged; a new one once it differs.
   *  Constrained to an object so serialising it always yields a string. */
  keyFor(payload: Readonly<Record<string, unknown>>): string;
  /** After a command succeeded — the next one is a new intent, not a retry. */
  reset(): void;
}

export const createIdempotencyKeeper = (
  newId: () => string = () => crypto.randomUUID(),
): IdempotencyKeeper => {
  let lastPayload: string | null = null;
  let lastKey: string | null = null;

  return {
    keyFor: (payload: Readonly<Record<string, unknown>>): string => {
      /*
       * Plain stringify is enough because every payload compared here is built
       * by one call site in a fixed literal order, so two equal payloads always
       * serialise identically. It is not a general-purpose canonical hash and
       * should not be used as one.
       */
      const serialised = JSON.stringify(payload);

      if (lastKey !== null && lastPayload === serialised) {
        return lastKey;
      }

      const key = newId();
      lastPayload = serialised;
      lastKey = key;
      return key;
    },
    reset: (): void => {
      lastPayload = null;
      lastKey = null;
    },
  };
};

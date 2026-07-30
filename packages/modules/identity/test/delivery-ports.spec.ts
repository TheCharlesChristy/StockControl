import { describe, expect, it } from "vitest";

import {
  createIdentityDeliveryBinding,
  deliveryKeyIdsInUse,
  identityDeliveryPurposes,
  normaliseEmailAddress,
  partitionExpiredDeliveryEnvelopes,
  userId,
  type IdentityDeliveryBinding,
  type IdentityDeliveryPurpose,
} from "../src/index";

const binding: IdentityDeliveryBinding = {
  purpose: "InvitationLink",
  jobId: "job-1",
  recipientUserId: userId("11111111-1111-4111-8111-111111111111"),
  recipientEmail: normaliseEmailAddress("sam@acme.test"),
  tokenRecordId: "invitation-1",
  installationId: "acme-yard",
};

describe("delivery binding", () => {
  it("accepts every supported purpose", () => {
    for (const purpose of identityDeliveryPurposes) {
      expect(createIdentityDeliveryBinding({ ...binding, purpose }).purpose).toBe(purpose);
    }
  });

  it("freezes the validated binding", () => {
    expect(Object.isFrozen(createIdentityDeliveryBinding(binding))).toBe(true);
  });

  it("rejects an unsupported purpose", () => {
    expect(() =>
      createIdentityDeliveryBinding({
        ...binding,
        purpose: "SessionCookie" as IdentityDeliveryPurpose,
      }),
    ).toThrowError(expect.objectContaining({ code: "DeliveryBindingInvalid" }));
  });

  it.each([
    ["job ID", "jobId"],
    ["recipient user ID", "recipientUserId"],
    ["token record ID", "tokenRecordId"],
    ["installation ID", "installationId"],
  ] as const)("rejects an empty %s", (_label, field) => {
    expect(() => createIdentityDeliveryBinding({ ...binding, [field]: "" })).toThrowError(
      expect.objectContaining({ code: "DeliveryBindingInvalid" }),
    );
  });

  it("rejects an over-long job ID", () => {
    expect(() =>
      createIdentityDeliveryBinding({ ...binding, jobId: "a".repeat(129) }),
    ).toThrowError(expect.objectContaining({ code: "DeliveryBindingInvalid" }));
  });

  it.each([
    ["too short", "a@"],
    ["too long", `${"a".repeat(250)}@acme.test`],
  ])("rejects a %s recipient email", (_label, email) => {
    expect(() =>
      createIdentityDeliveryBinding({
        ...binding,
        recipientEmail: email as typeof binding.recipientEmail,
      }),
    ).toThrowError(expect.objectContaining({ code: "DeliveryBindingInvalid" }));
  });
});

describe("expired delivery envelope cleanup", () => {
  const at = new Date("2026-07-30T12:00:00.000Z");
  const records = [
    { id: "already-expired", expiresAt: new Date("2026-07-30T11:59:59.999Z") },
    { id: "expiring-now", expiresAt: at },
    { id: "still-live", expiresAt: new Date("2026-07-30T12:00:00.001Z") },
  ];

  it("treats an envelope as expired at and before its expiry instant", () => {
    const partitioned = partitionExpiredDeliveryEnvelopes(records, at);

    expect(partitioned.expired.map(({ id }) => id)).toEqual(["already-expired", "expiring-now"]);
    expect(partitioned.retained.map(({ id }) => id)).toEqual(["still-live"]);
  });

  it("returns frozen partitions and handles an empty queue", () => {
    const partitioned = partitionExpiredDeliveryEnvelopes([], at);

    expect(partitioned.expired).toEqual([]);
    expect(Object.isFrozen(partitioned.expired)).toBe(true);
    expect(Object.isFrozen(partitioned)).toBe(true);
  });

  it("rejects an invalid cleanup instant", () => {
    expect(() => partitionExpiredDeliveryEnvelopes(records, new Date("not-a-date"))).toThrowError(
      expect.objectContaining({ code: "DeliveryEnvelopeInvalid" }),
    );
  });

  it("rejects a record without a valid expiry", () => {
    expect(() =>
      partitionExpiredDeliveryEnvelopes([{ expiresAt: new Date("not-a-date") }], at),
    ).toThrowError(expect.objectContaining({ code: "DeliveryEnvelopeInvalid" }));
  });
});

describe("delivery key retirement", () => {
  const at = new Date("2026-07-30T12:00:00.000Z");

  it("reports only the keys still needed to open unexpired envelopes", () => {
    const inUse = deliveryKeyIdsInUse(
      [
        { keyId: "retired-candidate", expiresAt: new Date("2026-07-30T11:00:00.000Z") },
        { keyId: "rotating", expiresAt: new Date("2026-07-30T13:00:00.000Z") },
        { keyId: "active", expiresAt: new Date("2026-07-30T13:30:00.000Z") },
        { keyId: "active", expiresAt: new Date("2026-07-30T14:00:00.000Z") },
      ],
      at,
    );

    expect(inUse).toEqual(["active", "rotating"]);
  });

  it("reports no keys in use once every envelope has expired", () => {
    expect(deliveryKeyIdsInUse([{ keyId: "rotating", expiresAt: at }], at)).toEqual([]);
  });

  it("rejects an invalid retirement instant", () => {
    expect(() => deliveryKeyIdsInUse([], new Date("not-a-date"))).toThrowError(
      expect.objectContaining({ code: "DeliveryEnvelopeInvalid" }),
    );
  });
});

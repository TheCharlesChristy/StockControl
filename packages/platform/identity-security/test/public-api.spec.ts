import { describe, expect, it } from "vitest";

import * as identitySecurity from "../src/index.js";

describe("identity security public API", () => {
  it("exports the complete supported runtime surface", () => {
    expect(Object.keys(identitySecurity).sort()).toEqual(
      [
        "BrowserRequestPolicy",
        "CSRF_COOKIE",
        "CSRF_HEADER_NAME",
        "CsrfTokenService",
        "HmacIdentityAuditIntegrity",
        "InvalidEncryptedTotpSecretError",
        "InvalidPasswordHashError",
        "MAX_PASSWORD_BYTES",
        "NodeCryptoArgon2idDeriver",
        "NodeRandomSource",
        "OpaqueTokenService",
        "PASSWORD_HASH_POLICY",
        "PERSISTED_TOKEN_HASH_BYTES",
        "PRE_AUTH_CSRF_BINDING",
        "PasswordHashingService",
        "RECOVERY_CODE_COUNT",
        "RECOVERY_CODE_RANDOM_BYTES",
        "RecoveryCodeService",
        "SESSION_COOKIE",
        "SESSION_TOKEN_DOMAIN",
        "SessionTokenService",
        "SystemClock",
        "TOTP_POLICY",
        "TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES",
        "TOTP_SECRET_ENCRYPTION_KEY_BYTES",
        "TOTP_SECRET_ENCRYPTION_NONCE_BYTES",
        "TOTP_SECRET_ENCRYPTION_VERSION",
        "TotpSecretEncryptionService",
        "TotpService",
        "constantTimeEqual",
        "createPersistedTokenHash",
        "createTotpProvisioningUri",
        "generateHotp",
        "normalizeRecoveryCode",
        "persistedTokenHashBytes",
      ].sort(),
    );
  });
});

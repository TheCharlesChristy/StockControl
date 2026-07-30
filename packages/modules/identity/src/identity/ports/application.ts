import type { IdentityDeliveryScheduler, IdentityDeliverySecretEnvelopeService } from "./delivery";
import type { IdentityAuditIntegrity, IdentityUnitOfWork } from "./persistence";
import type { IdentityPolicyProvider } from "./policy";
import type { IdentityRequestContextProvider } from "./request-context";
import type {
  IdentityClock,
  IdentityDummyPasswordHash,
  IdentityPasswordHasher,
  IdentityRecoveryCodeService,
  IdentityTokenServices,
  IdentityTotpSecretCipher,
  IdentityTotpService,
  IdentityUuidGenerator,
} from "./security";

/**
 * Everything an Identity use case may depend on. A use case receives this
 * bundle and nothing else, which keeps NestJS, Kysely, Node cryptography, and
 * deployment configuration out of the application layer.
 */
export interface IdentityApplicationPorts {
  readonly clock: IdentityClock;
  readonly uuids: IdentityUuidGenerator;
  readonly passwords: IdentityPasswordHasher;
  readonly dummyPasswordHash: IdentityDummyPasswordHash;
  readonly tokens: IdentityTokenServices;
  readonly totp: IdentityTotpService;
  readonly totpSecrets: IdentityTotpSecretCipher;
  readonly recoveryCodes: IdentityRecoveryCodeService;
  readonly auditIntegrity: IdentityAuditIntegrity;
  readonly deliveryEnvelopes: IdentityDeliverySecretEnvelopeService;
  readonly deliveries: IdentityDeliveryScheduler;
  readonly policy: IdentityPolicyProvider;
  readonly requestContext: IdentityRequestContextProvider;
  readonly unitOfWork: IdentityUnitOfWork;
}

/**
 * The adapter names production composition must supply and must prove are not
 * deterministic test doubles.
 */
export const identityApplicationPortNames: readonly (keyof IdentityApplicationPorts)[] =
  Object.freeze([
    "auditIntegrity",
    "clock",
    "deliveries",
    "deliveryEnvelopes",
    "dummyPasswordHash",
    "passwords",
    "policy",
    "recoveryCodes",
    "requestContext",
    "tokens",
    "totp",
    "totpSecrets",
    "unitOfWork",
    "uuids",
  ]);

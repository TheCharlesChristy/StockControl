import type {
  IdentityAuditIntegrity,
  IdentityTransactionRepositories,
  IdentityUnitOfWork,
} from "@stockcontrol/module-identity";

import { KyselyIdentityAuditEventRepository } from "./audit-repository";
import { KyselyIdentityAuthChallengeRepository } from "./auth-challenge-repository";
import { KyselyIdentityBootstrapStateRepository } from "./bootstrap-repository";
import type { IdentityRootDatabase } from "./database";
import { KyselyIdentityInvitationRepository } from "./invitation-repository";
import { KyselyIdentityMfaRecoveryRequestRepository } from "./mfa-recovery-repository";
import { KyselyIdentityPasswordCredentialRepository } from "./password-credential-repository";
import { KyselyIdentityPasswordResetRepository } from "./password-reset-repository";
import { KyselyIdentityPermissionOverrideRepository } from "./permission-repository";
import { KyselyIdentityRateLimitBucketRepository } from "./rate-limit-repository";
import { KyselyIdentityRecoveryCodeRepository } from "./recovery-code-repository";
import { KyselyIdentitySecurityPolicyRepository } from "./security-policy-repository";
import { KyselyIdentitySessionRepository } from "./session-repository";
import { KyselyIdentityTotpCredentialRepository } from "./totp-repository";
import { KyselyIdentityUserRepository } from "./user-repository";

export class KyselyIdentityUnitOfWork implements IdentityUnitOfWork {
  public constructor(
    private readonly database: IdentityRootDatabase,
    private readonly auditIntegrity: IdentityAuditIntegrity,
  ) {}

  public execute<Result>(
    operation: (repositories: IdentityTransactionRepositories) => Promise<Result>,
  ): Promise<Result> {
    return this.database
      .transaction()
      .setIsolationLevel("serializable")
      .execute((transaction) =>
        operation(
          Object.freeze({
            auditEvents: new KyselyIdentityAuditEventRepository(transaction, this.auditIntegrity),
            authChallenges: new KyselyIdentityAuthChallengeRepository(transaction),
            bootstrapState: new KyselyIdentityBootstrapStateRepository(transaction),
            invitations: new KyselyIdentityInvitationRepository(transaction),
            mfaRecoveryRequests: new KyselyIdentityMfaRecoveryRequestRepository(transaction),
            passwordCredentials: new KyselyIdentityPasswordCredentialRepository(transaction),
            passwordResets: new KyselyIdentityPasswordResetRepository(transaction),
            permissionOverrides: new KyselyIdentityPermissionOverrideRepository(transaction),
            rateLimitBuckets: new KyselyIdentityRateLimitBucketRepository(transaction),
            recoveryCodes: new KyselyIdentityRecoveryCodeRepository(transaction),
            securityPolicy: new KyselyIdentitySecurityPolicyRepository(transaction),
            sessions: new KyselyIdentitySessionRepository(transaction),
            totpCredentials: new KyselyIdentityTotpCredentialRepository(transaction),
            users: new KyselyIdentityUserRepository(transaction),
          }),
        ),
      );
  }
}

export {
  IdentityPersistenceInputError,
  type IdentityPersistenceInputErrorCode,
} from "./validation";

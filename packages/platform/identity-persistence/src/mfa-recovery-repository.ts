import {
  type ApproveMfaRecoveryRequest,
  type CloseMfaRecoveryRequest,
  type CompleteMfaRecoveryRequest,
  type CreateMfaRecoveryRequest,
  type IdentityMfaRecoveryRequestRepository,
  type PersistedMfaRecoveryRequest,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { mfaRecoveryRequestFromRow } from "./mappers";
import {
  IdentityPersistenceInputError,
  assertBoundedText,
  assertIntegerInRange,
  assertLifetime,
  assertUuid,
  assertValidDate,
} from "./validation";

const terminalStatuses = new Set<CloseMfaRecoveryRequest["status"]>([
  "Rejected",
  "Cancelled",
  "Expired",
]);

export class KyselyIdentityMfaRecoveryRequestRepository implements IdentityMfaRecoveryRequestRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async insert(command: CreateMfaRecoveryRequest): Promise<PersistedMfaRecoveryRequest> {
    assertLifetime(command.requestedAt, command.expiresAt, 7 * 86_400, "MFA recovery request");

    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_mfa_recovery_requests")
      .values({
        id: assertUuid(command.id, "MFA recovery request ID"),
        subject_user_id: assertUuid(command.subjectUserId, "Recovery subject user ID"),
        requested_by_user_id: assertUuid(command.requestedByUserId, "Recovery requester user ID"),
        approval_method: null,
        approved_by_user_id: null,
        vendor_case_reference: null,
        status: "Pending",
        reason: assertBoundedText(command.reason, 1_000, "MFA recovery reason"),
        requested_at: command.requestedAt,
        expires_at: command.expiresAt,
        resolved_at: null,
        completed_at: null,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return mfaRecoveryRequestFromRow(row);
  }

  public async findByIdForUpdate(id: string): Promise<PersistedMfaRecoveryRequest | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_mfa_recovery_requests")
      .selectAll()
      .where("id", "=", assertUuid(id, "MFA recovery request ID"))
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : mfaRecoveryRequestFromRow(row);
  }

  public async approve(
    command: ApproveMfaRecoveryRequest,
  ): Promise<PersistedMfaRecoveryRequest | undefined> {
    let approver: string | undefined;
    let vendorCaseReference: string | undefined;
    const approvalMethod: string = command.approvalMethod;
    if (approvalMethod === "ActiveAdmin" && "approvedByUserId" in command) {
      approver = assertUuid(command.approvedByUserId, "MFA recovery approver user ID");
    } else if (approvalMethod === "VendorVerification" && "vendorCaseReference" in command) {
      vendorCaseReference = assertBoundedText(
        command.vendorCaseReference,
        200,
        "Vendor recovery case reference",
      );
    }
    if (approver === undefined && vendorCaseReference === undefined) {
      throw new IdentityPersistenceInputError(
        "ScopeInvalid",
        "MFA recovery approval method is not supported.",
      );
    }
    const resolvedAt = assertValidDate(command.resolvedAt, "MFA recovery approval time");
    let query = this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_mfa_recovery_requests")
      .set((expression) => ({
        approval_method: approvalMethod as "ActiveAdmin" | "VendorVerification",
        approved_by_user_id: approver ?? null,
        vendor_case_reference: vendorCaseReference ?? null,
        status: "Approved",
        resolved_at: resolvedAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "MFA recovery request ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("status", "=", "Pending")
      .where("expires_at", ">", resolvedAt);

    if (approver !== undefined) {
      query = query
        .where("subject_user_id", "!=", approver)
        .where("requested_by_user_id", "!=", approver);
    }

    const row = await query.returningAll().executeTakeFirst();

    return row === undefined ? undefined : mfaRecoveryRequestFromRow(row);
  }

  public async close(
    command: CloseMfaRecoveryRequest,
  ): Promise<PersistedMfaRecoveryRequest | undefined> {
    if (!terminalStatuses.has(command.status)) {
      throw new IdentityPersistenceInputError(
        "ScopeInvalid",
        "MFA recovery close status is not supported.",
      );
    }
    const resolvedAt = assertValidDate(command.resolvedAt, "MFA recovery resolution time");
    let query = this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_mfa_recovery_requests")
      .set((expression) => ({
        status: command.status,
        resolved_at: resolvedAt,
        completed_at: null,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "MFA recovery request ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("status", "in", ["Pending", "Approved"]);

    if (command.status === "Expired") {
      query = query.where("expires_at", "<=", resolvedAt);
    }

    const row = await query.returningAll().executeTakeFirst();
    return row === undefined ? undefined : mfaRecoveryRequestFromRow(row);
  }

  public async complete(
    command: CompleteMfaRecoveryRequest,
  ): Promise<PersistedMfaRecoveryRequest | undefined> {
    const completedAt = assertValidDate(command.completedAt, "MFA recovery completion time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_mfa_recovery_requests")
      .set((expression) => ({
        status: "Completed",
        completed_at: completedAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "MFA recovery request ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("status", "=", "Approved")
      .where("expires_at", ">", completedAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : mfaRecoveryRequestFromRow(row);
  }
}

import {
  userId,
  type AppendIdentityAuditEvent,
  type IdentityAuditAppendResult,
  type IdentityAuditChainTail,
  type IdentityAuditEventRepository,
  type IdentityAuditIntegrity,
} from "@stockcontrol/module-identity";
import { sql } from "kysely";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import {
  IdentityPersistenceInputError,
  assertBoundedText,
  assertCorrelationId,
  assertUuid,
  assertValidDate,
  digestBytes,
  identityContextJson,
  optionalDigestBytes,
} from "./validation";

const auditOutcomes = new Set<AppendIdentityAuditEvent["outcome"]>([
  "Succeeded",
  "Denied",
  "Failed",
]);

const assertOutcome = (
  outcome: AppendIdentityAuditEvent["outcome"],
): AppendIdentityAuditEvent["outcome"] => {
  if (!auditOutcomes.has(outcome)) {
    throw new IdentityPersistenceInputError(
      "ScopeInvalid",
      "Identity audit outcome is not supported.",
    );
  }
  return outcome;
};

const assertIntegrityKeyId = (value: string): string => {
  const keyId = assertCorrelationId(value);
  if (keyId.length > 100) {
    throw new IdentityPersistenceInputError(
      "EncryptionKeyInvalid",
      "Audit integrity key ID cannot exceed 100 characters.",
    );
  }
  return keyId;
};

export class KyselyIdentityAuditEventRepository implements IdentityAuditEventRepository {
  public constructor(
    private readonly database: IdentityDatabaseExecutor,
    private readonly integrity: IdentityAuditIntegrity,
  ) {}

  private async lockTail(): Promise<IdentityAuditChainTail> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_audit_chain_head")
      .select(["last_sequence", "last_event_id", "last_event_hash"])
      .where("singleton_key", "=", 1)
      .forUpdate()
      .executeTakeFirstOrThrow();

    return Object.freeze({
      sequence: BigInt(row.last_sequence),
      ...(row.last_event_id === null ? {} : { eventId: row.last_event_id }),
      ...(row.last_event_hash === null
        ? {}
        : {
            eventHash: digestBytes(row.last_event_hash, "Stored audit-chain tail hash"),
          }),
    });
  }

  public async append(
    event: AppendIdentityAuditEvent,
  ): Promise<IdentityAuditAppendResult | undefined> {
    const eventId = assertUuid(event.id, "Audit event ID");
    const occurredAt = assertValidDate(event.occurredAt, "Audit occurrence time");
    const eventType = assertBoundedText(event.eventType, 100, "Audit event type");
    const outcome = assertOutcome(event.outcome);
    const actorUserId =
      event.actorUserId === undefined
        ? undefined
        : userId(assertUuid(event.actorUserId, "Actor user ID"));
    const subjectUserId =
      event.subjectUserId === undefined
        ? undefined
        : userId(assertUuid(event.subjectUserId, "Subject user ID"));
    const sessionId =
      event.sessionId === undefined ? undefined : assertUuid(event.sessionId, "Session ID");
    const correlationId = assertCorrelationId(event.correlationId);
    const remoteAddressHash =
      event.remoteAddressHash === undefined
        ? undefined
        : digestBytes(event.remoteAddressHash, "Remote address hash");
    const details = identityContextJson(event.details);
    const tail = await this.lockTail();
    const sequence = tail.sequence + 1n;

    if (
      (tail.sequence === 0n && tail.eventHash !== undefined) ||
      (tail.sequence > 0n && tail.eventHash === undefined)
    ) {
      throw new IdentityPersistenceInputError(
        "AuditChainInvalid",
        "Stored identity audit-chain head is inconsistent.",
      );
    }

    const seal = this.integrity.seal({
      id: eventId,
      sequence,
      occurredAt,
      eventType,
      outcome,
      ...(actorUserId === undefined ? {} : { actorUserId }),
      ...(subjectUserId === undefined ? {} : { subjectUserId }),
      ...(sessionId === undefined ? {} : { sessionId }),
      correlationId,
      ...(remoteAddressHash === undefined ? {} : { remoteAddressHash }),
      details,
      ...(tail.eventHash === undefined ? {} : { previousEventHash: tail.eventHash }),
    });
    const runtimeIntegrityVersion: unknown = seal.version;
    if (runtimeIntegrityVersion !== 1) {
      throw new IdentityPersistenceInputError(
        "EncryptionVersionInvalid",
        "Identity audit integrity version is not supported.",
      );
    }
    const integrityKeyId = assertIntegrityKeyId(seal.keyId);
    const eventHash = digestBytes(seal.eventHash, "Audit event hash");
    const previousEventHash = optionalDigestBytes(tail.eventHash, "Previous audit event hash");
    const previousHashPredicate =
      previousEventHash === null
        ? sql`last_event_hash is null`
        : sql`last_event_hash = ${previousEventHash}`;

    const result = await sql<{ readonly id: string }>`
      with advanced_head as (
        update stockcontrol.identity_audit_chain_head
        set
          last_sequence = ${sequence.toString()}::bigint,
          last_event_id = ${eventId}::uuid,
          last_event_hash = ${eventHash},
          updated_at = ${occurredAt}
        where singleton_key = 1
          and last_sequence = ${tail.sequence.toString()}::bigint
          and ${previousHashPredicate}
        returning singleton_key
      )
      insert into stockcontrol.identity_audit_events (
        id,
        sequence,
        occurred_at,
        event_type,
        outcome,
        actor_user_id,
        subject_user_id,
        session_id,
        correlation_id,
        remote_address_hash,
        details,
        previous_event_hash,
        integrity_version,
        integrity_key_id,
        event_hash
      )
      select
        ${eventId}::uuid,
        ${sequence.toString()}::bigint,
        ${occurredAt},
        ${eventType},
        ${outcome},
        ${actorUserId ?? null}::uuid,
        ${subjectUserId ?? null}::uuid,
        ${sessionId ?? null}::uuid,
        ${correlationId},
        ${remoteAddressHash ?? null}::bytea,
        ${JSON.stringify(details)}::jsonb,
        ${previousEventHash}::bytea,
        1,
        ${integrityKeyId},
        ${eventHash}
      from advanced_head
      returning id
    `.execute(this.database);

    return result.rows.length === 0
      ? undefined
      : Object.freeze({
          sequence,
          eventId,
          eventHash,
          integrityVersion: 1,
          integrityKeyId,
        });
  }
}

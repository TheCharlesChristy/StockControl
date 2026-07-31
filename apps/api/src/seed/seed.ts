import { randomUUID } from "node:crypto";

import {
  createMigratorDatabase,
  loadMigratorDatabaseConfiguration,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { hashPassword } from "../auth/password";
import { formatQuantity } from "../stock/quantity";
import { buildDemoWorld } from "./simulate";

/**
 * Writes the simulated demo world to PostgreSQL. It runs as the migrator role
 * because it clears existing data, which the runtime role is deliberately not
 * permitted to do to the append-only transaction log.
 */

const DEMO_PASSWORD = "demo-password";

async function clearExistingData(database: Kysely<StockControlDatabase>): Promise<void> {
  const schema = database.withSchema(STOCKCONTROL_SCHEMA);

  await schema.deleteFrom("transactions").execute();
  await schema.deleteFrom("stock_requests").execute();
  await schema.deleteFrom("reservations").execute();
  await schema.deleteFrom("stock_levels").execute();
  await schema.deleteFrom("items").execute();
  await schema.deleteFrom("locations").execute();
  await schema.deleteFrom("job_assignments").execute();
  await schema.deleteFrom("jobs").execute();
  await schema.deleteFrom("sessions").execute();
  await schema.deleteFrom("users").execute();
}

async function insertInChunks<Row>(
  rows: readonly Row[],
  size: number,
  write: (chunk: readonly Row[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += size) {
    await write(rows.slice(start, start + size));
  }
}

const seed = async (): Promise<void> => {
  const database = createMigratorDatabase(loadMigratorDatabaseConfiguration());
  const schema = database.withSchema(STOCKCONTROL_SCHEMA);

  try {
    const world = buildDemoWorld({ createId: randomUUID, now: new Date() });
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    await clearExistingData(database);

    await schema
      .insertInto("users")
      .values(
        world.users.map((user) => ({
          id: user.id,
          email: user.email,
          display_name: user.displayName,
          role: user.role,
          password_hash: passwordHash,
          is_active: true,
        })),
      )
      .execute();

    await schema
      .insertInto("jobs")
      .values(
        world.jobs.map((job) => ({
          id: job.id,
          number: job.number,
          name: job.name,
          customer: job.customer,
          status: job.closedAt === null ? ("Open" as const) : ("Closed" as const),
          created_at: job.createdAt,
          updated_at: job.closedAt ?? job.createdAt,
          closed_at: job.closedAt,
        })),
      )
      .execute();

    await schema
      .insertInto("locations")
      .values(
        world.locations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
          kind: location.kind,
          job_id: location.jobId,
          is_active: true,
        })),
      )
      .execute();

    await insertInChunks(world.items, 200, (chunk) =>
      schema
        .insertInto("items")
        .values(
          chunk.map((item) => ({
            id: item.id,
            reference: item.reference,
            name: item.name,
            unit: item.unit,
            barcode: item.barcode,
            part_number: item.partNumber,
            low_stock_threshold: item.lowStockThreshold,
            is_active: true,
          })),
        )
        .execute(),
    );

    await insertInChunks(world.stockLevels, 500, (chunk) =>
      schema
        .insertInto("stock_levels")
        .values(
          chunk.map((level) => ({
            id: randomUUID(),
            item_id: level.itemId,
            location_id: level.locationId,
            quantity: formatQuantity(level.quantity),
          })),
        )
        .execute(),
    );

    if (world.reservations.length > 0) {
      await schema
        .insertInto("reservations")
        .values(
          world.reservations.map((reservation) => ({
            id: reservation.id,
            job_id: reservation.jobId,
            item_id: reservation.itemId,
            quantity_reserved: formatQuantity(reservation.quantityReserved),
            quantity_collected: formatQuantity(reservation.quantityCollected),
            status: reservation.status,
            created_by_user_id: reservation.createdByUserId,
            created_at: reservation.createdAt,
            updated_at: reservation.createdAt,
          })),
        )
        .execute();
    }

    if (world.jobAssignments.length > 0) {
      await schema
        .insertInto("job_assignments")
        .values(
          world.jobAssignments.map((assignment) => ({
            job_id: assignment.jobId,
            user_id: assignment.userId,
            assigned_by_user_id: assignment.assignedByUserId,
          })),
        )
        .execute();
    }

    if (world.stockRequests.length > 0) {
      await schema
        .insertInto("stock_requests")
        .values(
          world.stockRequests.map((request) => ({
            id: request.id,
            reference: request.reference,
            item_id: request.itemId,
            job_id: request.jobId,
            quantity: request.quantity,
            note: request.note,
            status: request.status,
            requested_by_user_id: request.requestedByUserId,
            decided_by_user_id: request.decidedByUserId,
            decided_at: request.decidedAt,
            decision_note: request.decisionNote,
            reservation_id: null,
            created_at: request.createdAt,
            updated_at: request.decidedAt ?? request.createdAt,
          })),
        )
        .execute();
    }

    await insertInChunks(world.transactions, 500, (chunk) =>
      schema
        .insertInto("transactions")
        .values(
          chunk.map((transaction) => ({
            id: transaction.id,
            kind: transaction.kind,
            item_id: transaction.itemId,
            quantity: formatQuantity(transaction.quantity),
            from_location_id: transaction.fromLocationId,
            to_location_id: transaction.toLocationId,
            job_id: transaction.jobId,
            reservation_id: transaction.reservationId,
            reason: transaction.reason,
            actor_user_id: transaction.actorUserId,
            occurred_at: transaction.occurredAt,
          })),
        )
        .execute(),
    );

    process.stdout.write(
      `${JSON.stringify({
        event: "database.seed.complete",
        users: world.users.length,
        locations: world.locations.length,
        items: world.items.length,
        jobs: world.jobs.length,
        jobAssignments: world.jobAssignments.length,
        reservations: world.reservations.length,
        stockRequests: world.stockRequests.length,
        stockLevels: world.stockLevels.length,
        transactions: world.transactions.length,
        password: DEMO_PASSWORD,
        signIn: world.users.map((user) => `${user.email} (${user.role})`),
      })}\n`,
    );
  } finally {
    await database.destroy();
  }
};

void seed().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "database.seed.failed",
      error: error instanceof Error ? error.message : "UnknownError",
    })}\n`,
  );
  process.exitCode = 1;
});

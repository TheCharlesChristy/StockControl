import type { DashboardReservationView, DashboardResponse } from "@stockcontrol/contracts";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { listItems, listTransactions } from "../persistence/read-models";
import { formatQuantity, quantityFromDatabase, subtract } from "../stock/quantity";

const SCHEMA = "stockcontrol" as const;
const LOW_STOCK_LIMIT = 10;
const RECENT_LIMIT = 10;

export class DashboardService {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async forUser(userId: string): Promise<DashboardResponse> {
    const [lowStock, myReservations, recent, counts] = await Promise.all([
      this.lowStock(),
      this.reservationsFor(userId),
      listTransactions(this.database, { limit: RECENT_LIMIT, offset: 0 }),
      this.counts(),
    ]);

    return { lowStock, myReservations, recentTransactions: recent.rows, counts };
  }

  /**
   * Only items that carry a threshold can be below it, so the scan is limited
   * to those rather than every item in the catalogue.
   */
  private async lowStock(): Promise<DashboardResponse["lowStock"]> {
    const candidates = await this.database
      .withSchema(SCHEMA)
      .selectFrom("items")
      .select("id")
      .where("low_stock_threshold", "is not", null)
      .where("is_active", "=", true)
      .execute();

    if (candidates.length === 0) {
      return [];
    }

    const { rows } = await listItems(this.database, {
      limit: candidates.length,
      offset: 0,
      belowThresholdOnly: true,
    });

    return rows.slice(0, LOW_STOCK_LIMIT);
  }

  private async reservationsFor(userId: string): Promise<readonly DashboardReservationView[]> {
    const rows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("reservations")
      .innerJoin("items", "items.id", "reservations.item_id")
      .innerJoin("jobs", "jobs.id", "reservations.job_id")
      .innerJoin("users", "users.id", "reservations.created_by_user_id")
      .select([
        "reservations.id as id",
        "reservations.item_id as item_id",
        "reservations.quantity_reserved as quantity_reserved",
        "reservations.quantity_collected as quantity_collected",
        "reservations.status as status",
        "reservations.created_at as created_at",
        "items.reference as item_reference",
        "items.name as item_name",
        "items.unit as unit",
        "jobs.id as job_id",
        "jobs.number as job_number",
        "jobs.name as job_name",
        "users.display_name as created_by_name",
      ])
      .where("reservations.created_by_user_id", "=", userId)
      .where("reservations.status", "=", "Open")
      .orderBy("reservations.created_at", "desc")
      .limit(RECENT_LIMIT)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      itemReference: row.item_reference,
      itemName: row.item_name,
      unit: row.unit,
      quantityReserved: row.quantity_reserved,
      quantityCollected: row.quantity_collected,
      quantityOutstanding: formatQuantity(
        subtract(
          quantityFromDatabase(row.quantity_reserved),
          quantityFromDatabase(row.quantity_collected),
        ),
      ),
      status: row.status,
      createdByName: row.created_by_name,
      createdAt: row.created_at.toISOString(),
      jobId: row.job_id,
      jobNumber: row.job_number,
      jobName: row.job_name,
    }));
  }

  private async counts(): Promise<DashboardResponse["counts"]> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("items")
      .select((builder) => [
        builder.fn.countAll<string>().as("items"),
        sql<string>`(select count(*) from stockcontrol.jobs where status = 'Open')`.as("open_jobs"),
        sql<string>`(select count(*) from stockcontrol.reservations where status = 'Open')`.as(
          "open_reservations",
        ),
      ])
      .where("is_active", "=", true)
      .executeTakeFirst();

    return {
      items: Number(row?.items ?? 0),
      openJobs: Number(row?.open_jobs ?? 0),
      openReservations: Number(row?.open_reservations ?? 0),
    };
  }
}

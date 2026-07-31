import type {
  ItemDetailView,
  ItemSummaryView,
  LocationBalanceView,
  LocationView,
  ReservationView,
  TransactionView,
} from "@stockcontrol/contracts";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely, type Transaction } from "kysely";

import { calculateAvailability, type LocationBalance } from "../stock/availability";
import {
  formatQuantity,
  quantityFromDatabase,
  subtract,
  ZERO,
  type Quantity,
} from "../stock/quantity";

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Database = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

export interface ItemQuery {
  readonly search?: string | undefined;
  readonly limit: number;
  readonly offset: number;
  readonly belowThresholdOnly?: boolean | undefined;
}

export interface TransactionQuery {
  readonly itemId?: string | undefined;
  readonly jobId?: string | undefined;
  readonly actorUserId?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly limit: number;
  readonly offset: number;
}

interface ItemRow {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly unit: string;
  readonly barcode: string | null;
  readonly part_number: string | null;
  readonly low_stock_threshold: string | null;
  readonly is_active: boolean;
}

interface BalanceRow {
  readonly item_id: string;
  readonly location_id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: "Store" | "JobSite";
  readonly quantity: string;
}

async function balancesFor(
  database: Database,
  itemIds: readonly string[],
): Promise<Map<string, BalanceRow[]>> {
  const grouped = new Map<string, BalanceRow[]>();

  if (itemIds.length === 0) {
    return grouped;
  }

  const rows = await database
    .withSchema(SCHEMA)
    .selectFrom("stock_levels")
    .innerJoin("locations", "locations.id", "stock_levels.location_id")
    .select([
      "stock_levels.item_id as item_id",
      "stock_levels.location_id as location_id",
      "stock_levels.quantity as quantity",
      "locations.code as code",
      "locations.name as name",
      "locations.kind as kind",
    ])
    .where("stock_levels.item_id", "in", itemIds)
    .orderBy("locations.code")
    .execute();

  for (const row of rows) {
    grouped.set(row.item_id, [...(grouped.get(row.item_id) ?? []), row]);
  }

  return grouped;
}

async function openReservedFor(
  database: Database,
  itemIds: readonly string[],
): Promise<Map<string, Quantity>> {
  const reserved = new Map<string, Quantity>();

  if (itemIds.length === 0) {
    return reserved;
  }

  const rows = await database
    .withSchema(SCHEMA)
    .selectFrom("reservations")
    .select((builder) => [
      "item_id",
      builder.fn.sum<string>(sql<string>`quantity_reserved - quantity_collected`).as("outstanding"),
    ])
    .where("item_id", "in", itemIds)
    .where("status", "=", "Open")
    .groupBy("item_id")
    .execute();

  for (const row of rows) {
    reserved.set(row.item_id, quantityFromDatabase(row.outstanding));
  }

  return reserved;
}

function toBalanceView(row: BalanceRow): LocationBalanceView {
  return {
    locationId: row.location_id,
    locationCode: row.code,
    locationName: row.name,
    kind: row.kind,
    quantity: row.quantity,
  };
}

function summarise(
  item: ItemRow,
  balanceRows: readonly BalanceRow[],
  openReserved: Quantity,
): ItemSummaryView {
  const balances: LocationBalance[] = balanceRows.map((row) => ({
    locationId: row.location_id,
    locationCode: row.code,
    kind: row.kind,
    quantity: quantityFromDatabase(row.quantity),
  }));
  const availability = calculateAvailability({
    itemId: item.id,
    balances,
    openReservedQuantity: openReserved,
  });
  const threshold =
    item.low_stock_threshold === null ? null : quantityFromDatabase(item.low_stock_threshold);

  return {
    id: item.id,
    reference: item.reference,
    name: item.name,
    unit: item.unit,
    barcode: item.barcode,
    partNumber: item.part_number,
    lowStockThreshold: item.low_stock_threshold,
    isActive: item.is_active,
    onHand: formatQuantity(availability.onHand),
    inStores: formatQuantity(availability.inStores),
    atJobSites: formatQuantity(availability.atJobSites),
    reserved: formatQuantity(availability.reserved),
    available: formatQuantity(availability.available),
    belowThreshold: threshold !== null && availability.available < threshold,
  };
}

export async function listItems(
  database: Database,
  query: ItemQuery,
): Promise<{ readonly rows: readonly ItemSummaryView[]; readonly total: number }> {
  let selection = database.withSchema(SCHEMA).selectFrom("items");

  const search = query.search?.trim();

  if (search !== undefined && search.length > 0) {
    const pattern = `%${search.toLowerCase()}%`;
    selection = selection.where((builder) =>
      builder.or([
        builder(sql<string>`lower(reference)`, "like", pattern),
        builder(sql<string>`lower(name)`, "like", pattern),
        builder(sql<string>`lower(coalesce(barcode, ''))`, "like", pattern),
        builder(sql<string>`lower(coalesce(part_number, ''))`, "like", pattern),
      ]),
    );
  }

  const totalRow = await selection
    .select((builder) => builder.fn.countAll<string>().as("total"))
    .executeTakeFirst();

  const rows = (await selection
    .select([
      "id",
      "reference",
      "name",
      "unit",
      "barcode",
      "part_number",
      "low_stock_threshold",
      "is_active",
    ])
    .orderBy("reference")
    .limit(query.limit)
    .offset(query.offset)
    .execute()) as readonly ItemRow[];

  const itemIds = rows.map((row) => row.id);
  const [balances, reserved] = await Promise.all([
    balancesFor(database, itemIds),
    openReservedFor(database, itemIds),
  ]);

  const summaries = rows.map((row) =>
    summarise(row, balances.get(row.id) ?? [], reserved.get(row.id) ?? ZERO),
  );

  return {
    rows:
      query.belowThresholdOnly === true ? summaries.filter((row) => row.belowThreshold) : summaries,
    total: Number(totalRow?.total ?? 0),
  };
}

export async function findItemDetail(
  database: Database,
  itemId: string,
): Promise<ItemDetailView | undefined> {
  const item = (await database
    .withSchema(SCHEMA)
    .selectFrom("items")
    .select([
      "id",
      "reference",
      "name",
      "unit",
      "barcode",
      "part_number",
      "low_stock_threshold",
      "is_active",
    ])
    .where("id", "=", itemId)
    .executeTakeFirst()) as ItemRow | undefined;

  if (item === undefined) {
    return undefined;
  }

  const [balances, reserved, transactions] = await Promise.all([
    balancesFor(database, [itemId]),
    openReservedFor(database, [itemId]),
    listTransactions(database, { itemId, limit: 20, offset: 0 }),
  ]);
  const balanceRows = balances.get(itemId) ?? [];

  return {
    ...summarise(item, balanceRows, reserved.get(itemId) ?? ZERO),
    balances: balanceRows.map(toBalanceView),
    recentTransactions: transactions.rows,
  };
}

export async function findItemByReference(
  database: Database,
  reference: string,
): Promise<{ readonly id: string } | undefined> {
  return database
    .withSchema(SCHEMA)
    .selectFrom("items")
    .select("id")
    .where("reference", "=", reference)
    .executeTakeFirst();
}

export async function listLocations(database: Database): Promise<readonly LocationView[]> {
  const rows = await database
    .withSchema(SCHEMA)
    .selectFrom("locations")
    .select(["id", "code", "name", "kind", "job_id", "is_active"])
    .orderBy("kind")
    .orderBy("code")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    jobId: row.job_id,
    isActive: row.is_active,
  }));
}

export async function listTransactions(
  database: Database,
  query: TransactionQuery,
): Promise<{ readonly rows: readonly TransactionView[]; readonly total: number }> {
  let selection = database
    .withSchema(SCHEMA)
    .selectFrom("transactions")
    .innerJoin("items", "items.id", "transactions.item_id")
    .innerJoin("users", "users.id", "transactions.actor_user_id")
    .leftJoin("locations as from_location", "from_location.id", "transactions.from_location_id")
    .leftJoin("locations as to_location", "to_location.id", "transactions.to_location_id")
    .leftJoin("jobs", "jobs.id", "transactions.job_id");

  /*
   * The log is filtered by whichever identifier the caller has to hand. Screens
   * link through with the reference people actually read off a label, and
   * anything that is not a UUID is matched against it rather than compared to
   * the id column, which would fail the uuid cast outright.
   */
  if (query.itemId !== undefined) {
    const filter = query.itemId;

    selection = UUID_PATTERN.test(filter)
      ? selection.where("transactions.item_id", "=", filter)
      : selection.where(sql<string>`upper(items.reference)`, "=", filter.trim().toUpperCase());
  }
  if (query.jobId !== undefined) {
    selection = selection.where("transactions.job_id", "=", query.jobId);
  }
  if (query.actorUserId !== undefined) {
    selection = selection.where("transactions.actor_user_id", "=", query.actorUserId);
  }
  if (query.from !== undefined) {
    selection = selection.where("transactions.occurred_at", ">=", query.from);
  }
  if (query.to !== undefined) {
    selection = selection.where("transactions.occurred_at", "<=", query.to);
  }

  const totalRow = await selection
    .select((builder) => builder.fn.countAll<string>().as("total"))
    .executeTakeFirst();

  const rows = await selection
    .select([
      "transactions.id as id",
      "transactions.kind as kind",
      "transactions.item_id as item_id",
      "transactions.quantity as quantity",
      "transactions.reason as reason",
      "transactions.occurred_at as occurred_at",
      "items.reference as item_reference",
      "items.name as item_name",
      "items.unit as unit",
      "from_location.code as from_code",
      "to_location.code as to_code",
      "jobs.number as job_number",
      "users.display_name as actor_name",
    ])
    .orderBy("transactions.occurred_at", "desc")
    .orderBy("transactions.id", "desc")
    .limit(query.limit)
    .offset(query.offset)
    .execute();

  return {
    total: Number(totalRow?.total ?? 0),
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      itemId: row.item_id,
      itemReference: row.item_reference,
      itemName: row.item_name,
      unit: row.unit,
      quantity: row.quantity,
      fromLocationCode: row.from_code,
      toLocationCode: row.to_code,
      jobNumber: row.job_number,
      reason: row.reason,
      actorName: row.actor_name,
      occurredAt: row.occurred_at.toISOString(),
    })),
  };
}

export async function listReservationsForJob(
  database: Database,
  jobId: string,
): Promise<readonly ReservationView[]> {
  const rows = await database
    .withSchema(SCHEMA)
    .selectFrom("reservations")
    .innerJoin("items", "items.id", "reservations.item_id")
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
      "users.display_name as created_by_name",
    ])
    .where("reservations.job_id", "=", jobId)
    .orderBy("reservations.created_at", "desc")
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
  }));
}

export async function jobSiteStock(
  database: Database,
  locationId: string,
): Promise<readonly LocationBalanceView[]> {
  const rows = await database
    .withSchema(SCHEMA)
    .selectFrom("stock_levels")
    .innerJoin("locations", "locations.id", "stock_levels.location_id")
    .innerJoin("items", "items.id", "stock_levels.item_id")
    .select([
      "stock_levels.location_id as location_id",
      "stock_levels.quantity as quantity",
      "locations.code as code",
      "locations.kind as kind",
      "items.reference as item_reference",
      "items.name as item_name",
    ])
    .where("stock_levels.location_id", "=", locationId)
    .where("stock_levels.quantity", ">", "0")
    .orderBy("items.reference")
    .execute();

  return rows.map((row) => ({
    locationId: row.location_id,
    locationCode: row.code,
    locationName: `${row.item_reference} — ${row.item_name}`,
    kind: row.kind,
    quantity: row.quantity,
  }));
}

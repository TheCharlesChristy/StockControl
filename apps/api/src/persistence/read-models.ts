import type {
  DashboardReservationView,
  ItemDetailView,
  ItemSummaryView,
  JobAssigneeView,
  LocationBalanceView,
  LocationView,
  ReservationView,
  StockRequestStatus,
  StockRequestView,
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
  /** Whose commitments `reservedForYou` reports. */
  readonly viewerUserId: string;
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
  createdByUserId?: string,
): Promise<Map<string, Quantity>> {
  const reserved = new Map<string, Quantity>();

  if (itemIds.length === 0) {
    return reserved;
  }

  let selection = database
    .withSchema(SCHEMA)
    .selectFrom("reservations")
    .select((builder) => [
      "item_id",
      builder.fn.sum<string>(sql<string>`quantity_reserved - quantity_collected`).as("outstanding"),
    ])
    .where("item_id", "in", itemIds)
    .where("status", "=", "Open");

  if (createdByUserId !== undefined) {
    selection = selection.where("created_by_user_id", "=", createdByUserId);
  }

  const rows = await selection.groupBy("item_id").execute();

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
  reservedForViewer: Quantity,
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
    reservedForYou: formatQuantity(reservedForViewer),
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
  const [balances, reserved, reservedForViewer] = await Promise.all([
    balancesFor(database, itemIds),
    openReservedFor(database, itemIds),
    openReservedFor(database, itemIds, query.viewerUserId),
  ]);

  const summaries = rows.map((row) =>
    summarise(
      row,
      balances.get(row.id) ?? [],
      reserved.get(row.id) ?? ZERO,
      reservedForViewer.get(row.id) ?? ZERO,
    ),
  );

  return {
    rows:
      query.belowThresholdOnly === true ? summaries.filter((row) => row.belowThreshold) : summaries,
    total: Number(totalRow?.total ?? 0),
  };
}

export interface ItemDetailOptions {
  readonly viewerUserId: string;
  /**
   * When the viewer may not see other people's activity, the item's history is
   * narrowed to their own. Requirements section 9.2 gives an Engineer their own
   * activity and nobody else's.
   */
  readonly scopeActivityToViewer: boolean;
}

export async function findItemDetail(
  database: Database,
  itemId: string,
  options: ItemDetailOptions,
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

  const [balances, reserved, reservedForViewer, transactions] = await Promise.all([
    balancesFor(database, [itemId]),
    openReservedFor(database, [itemId]),
    openReservedFor(database, [itemId], options.viewerUserId),
    listTransactions(database, {
      itemId,
      limit: 20,
      offset: 0,
      ...(options.scopeActivityToViewer ? { actorUserId: options.viewerUserId } : {}),
    }),
  ]);
  const balanceRows = balances.get(itemId) ?? [];

  return {
    ...summarise(
      item,
      balanceRows,
      reserved.get(itemId) ?? ZERO,
      reservedForViewer.get(itemId) ?? ZERO,
    ),
    balances: balanceRows.map(toBalanceView),
    recentTransactions: transactions.rows,
  };
}

/**
 * Resolves whatever is printed on a label or read by a scanner: the internal
 * reference, a supplier barcode, or a manufacturer part number.
 */
export async function findItemByCode(
  database: Database,
  code: string,
): Promise<{ readonly id: string } | undefined> {
  const trimmed = code.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const upper = trimmed.toUpperCase();

  return database
    .withSchema(SCHEMA)
    .selectFrom("items")
    .select("id")
    .where((builder) =>
      builder.or([
        builder(sql<string>`upper(reference)`, "=", upper),
        builder(sql<string>`upper(coalesce(barcode, ''))`, "=", upper),
        builder(sql<string>`upper(coalesce(part_number, ''))`, "=", upper),
      ]),
    )
    .orderBy(sql`case when upper(reference) = ${upper} then 0 else 1 end`)
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
      "transactions.actor_user_id as actor_user_id",
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
      actorUserId: row.actor_user_id,
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
      "reservations.created_by_user_id as created_by_user_id",
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
    createdById: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  }));
}

/**
 * Open reservations across jobs, for the dashboards. `createdByUserId` narrows
 * it to one person's commitments; without it the caller sees the whole
 * outstanding book, which is what an Office user coordinates against.
 */
export async function listOpenReservations(
  database: Database,
  options: {
    readonly createdByUserId?: string | undefined;
    readonly limit: number;
  },
): Promise<readonly DashboardReservationView[]> {
  let selection = database
    .withSchema(SCHEMA)
    .selectFrom("reservations")
    .innerJoin("items", "items.id", "reservations.item_id")
    .innerJoin("jobs", "jobs.id", "reservations.job_id")
    .innerJoin("users", "users.id", "reservations.created_by_user_id")
    .where("reservations.status", "=", "Open");

  if (options.createdByUserId !== undefined) {
    selection = selection.where("reservations.created_by_user_id", "=", options.createdByUserId);
  }

  const rows = await selection
    .select([
      "reservations.id as id",
      "reservations.item_id as item_id",
      "reservations.quantity_reserved as quantity_reserved",
      "reservations.quantity_collected as quantity_collected",
      "reservations.status as status",
      "reservations.created_at as created_at",
      "reservations.created_by_user_id as created_by_user_id",
      "items.reference as item_reference",
      "items.name as item_name",
      "items.unit as unit",
      "jobs.id as job_id",
      "jobs.number as job_number",
      "jobs.name as job_name",
      "users.display_name as created_by_name",
    ])
    .orderBy("reservations.created_at", "desc")
    .limit(options.limit)
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
    createdById: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    jobId: row.job_id,
    jobNumber: row.job_number,
    jobName: row.job_name,
  }));
}

/** Who is assigned to each of the given jobs, keyed by job id. */
export async function assigneesForJobs(
  database: Database,
  jobIds: readonly string[],
): Promise<Map<string, JobAssigneeView[]>> {
  const grouped = new Map<string, JobAssigneeView[]>();

  if (jobIds.length === 0) {
    return grouped;
  }

  const rows = await database
    .withSchema(SCHEMA)
    .selectFrom("job_assignments")
    .innerJoin("users", "users.id", "job_assignments.user_id")
    .select([
      "job_assignments.job_id as job_id",
      "job_assignments.user_id as user_id",
      "users.display_name as display_name",
      "users.role as role",
    ])
    .where("job_assignments.job_id", "in", jobIds)
    .orderBy("users.display_name")
    .execute();

  for (const row of rows) {
    grouped.set(row.job_id, [
      ...(grouped.get(row.job_id) ?? []),
      { userId: row.user_id, displayName: row.display_name, role: row.role },
    ]);
  }

  return grouped;
}

export interface StockRequestQuery {
  readonly id?: string | undefined;
  readonly status?: StockRequestStatus | undefined;
  readonly requestedByUserId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly jobId?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export async function listStockRequests(
  database: Database,
  query: StockRequestQuery,
): Promise<{ readonly rows: readonly StockRequestView[]; readonly total: number }> {
  let selection = database
    .withSchema(SCHEMA)
    .selectFrom("stock_requests")
    .innerJoin("items", "items.id", "stock_requests.item_id")
    .innerJoin("users as requester", "requester.id", "stock_requests.requested_by_user_id")
    .leftJoin("users as decider", "decider.id", "stock_requests.decided_by_user_id")
    .leftJoin("jobs", "jobs.id", "stock_requests.job_id");

  if (query.id !== undefined) {
    selection = selection.where("stock_requests.id", "=", query.id);
  }
  if (query.status !== undefined) {
    selection = selection.where("stock_requests.status", "=", query.status);
  }
  if (query.requestedByUserId !== undefined) {
    selection = selection.where(
      "stock_requests.requested_by_user_id",
      "=",
      query.requestedByUserId,
    );
  }
  if (query.itemId !== undefined) {
    selection = selection.where("stock_requests.item_id", "=", query.itemId);
  }
  if (query.jobId !== undefined) {
    selection = selection.where("stock_requests.job_id", "=", query.jobId);
  }

  const totalRow = await selection
    .select((builder) => builder.fn.countAll<string>().as("total"))
    .executeTakeFirst();

  const rows = await selection
    .select([
      "stock_requests.id as id",
      "stock_requests.reference as reference",
      "stock_requests.item_id as item_id",
      "stock_requests.job_id as job_id",
      "stock_requests.quantity as quantity",
      "stock_requests.note as note",
      "stock_requests.status as status",
      "stock_requests.requested_by_user_id as requested_by_user_id",
      "stock_requests.decision_note as decision_note",
      "stock_requests.reservation_id as reservation_id",
      "stock_requests.created_at as created_at",
      "stock_requests.decided_at as decided_at",
      "items.reference as item_reference",
      "items.name as item_name",
      "items.unit as unit",
      "jobs.number as job_number",
      "jobs.name as job_name",
      "requester.display_name as requested_by_name",
      "decider.display_name as decided_by_name",
    ])
    /* Pending first: the queue is the point of the screen. */
    .orderBy(sql`case when stock_requests.status = 'Pending' then 0 else 1 end`)
    .orderBy("stock_requests.created_at", "desc")
    .limit(query.limit)
    .offset(query.offset)
    .execute();

  return {
    total: Number(totalRow?.total ?? 0),
    rows: rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      itemId: row.item_id,
      itemReference: row.item_reference,
      itemName: row.item_name,
      unit: row.unit,
      jobId: row.job_id,
      jobNumber: row.job_number,
      jobName: row.job_name,
      quantity: row.quantity,
      note: row.note,
      status: row.status,
      requestedById: row.requested_by_user_id,
      requestedByName: row.requested_by_name,
      decidedByName: row.decided_by_name,
      decisionNote: row.decision_note,
      reservationId: row.reservation_id,
      createdAt: row.created_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
    })),
  };
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

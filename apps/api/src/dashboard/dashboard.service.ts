import type {
  DashboardResponse,
  EngineerDashboardResponse,
  EngineerJobView,
  OfficeDashboardResponse,
  UserRole,
} from "@stockcontrol/contracts";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import type { JobsService } from "../jobs/jobs.service";
import {
  jobSiteStock,
  listItems,
  listOpenReservations,
  listStockRequests,
  listTransactions,
} from "../persistence/read-models";

const SCHEMA = "stockcontrol" as const;
const LOW_STOCK_LIMIT = 10;
const RECENT_LIMIT = 10;
const RESERVATION_LIMIT = 20;
const REQUEST_LIMIT = 10;

export interface DashboardViewer {
  readonly id: string;
  readonly role: UserRole;
}

/**
 * The dashboard is the one screen shaped by who is looking. An Engineer is
 * shown their own work — their jobs, their commitments, their requests — and no
 * business-wide totals. Office and Admin are shown what needs a decision.
 */
export class DashboardService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly jobs: JobsService,
  ) {}

  public forUser(viewer: DashboardViewer): Promise<DashboardResponse> {
    return viewer.role === "Engineer" ? this.forEngineer(viewer) : this.forOffice(viewer);
  }

  private async forEngineer(viewer: DashboardViewer): Promise<EngineerDashboardResponse> {
    const [myJobs, myReservations, myRequests] = await Promise.all([
      this.assignedJobs(viewer.id),
      listOpenReservations(this.database, {
        createdByUserId: viewer.id,
        limit: RESERVATION_LIMIT,
      }),
      listStockRequests(this.database, {
        requestedByUserId: viewer.id,
        limit: REQUEST_LIMIT,
        offset: 0,
      }),
    ]);

    return { role: "Engineer", myJobs, myReservations, myRequests: myRequests.rows };
  }

  private async forOffice(viewer: DashboardViewer): Promise<OfficeDashboardResponse> {
    const [
      lowStock,
      upcomingJobs,
      openReservations,
      myReservations,
      pendingRequests,
      recent,
      counts,
    ] = await Promise.all([
      this.lowStock(viewer.id),
      this.jobs.list({ status: "Open" }),
      listOpenReservations(this.database, { limit: RESERVATION_LIMIT }),
      /*
       * Queried rather than filtered out of the list above: that one is capped,
       * so filtering it would quietly hide this person's older commitments.
       */
      listOpenReservations(this.database, {
        createdByUserId: viewer.id,
        limit: RESERVATION_LIMIT,
      }),
      listStockRequests(this.database, {
        status: "Pending",
        limit: REQUEST_LIMIT,
        offset: 0,
      }),
      listTransactions(this.database, { limit: RECENT_LIMIT, offset: 0 }),
      this.counts(),
    ]);

    return {
      role: viewer.role === "Admin" ? "Admin" : "Office",
      lowStock,
      upcomingJobs: upcomingJobs.slice(0, RECENT_LIMIT),
      openReservations,
      myReservations,
      pendingRequests: pendingRequests.rows,
      recentTransactions: recent.rows,
      counts: { ...counts, pendingRequests: pendingRequests.total },
    };
  }

  /** The jobs this person is on, each with whatever is sitting on its site. */
  private async assignedJobs(userId: string): Promise<readonly EngineerJobView[]> {
    const jobs = await this.jobs.list({ assignedTo: userId, status: "Open" });

    return Promise.all(
      jobs.map(async (job) => ({
        ...job,
        jobSiteStock: await jobSiteStock(this.database, job.jobSiteLocationId),
      })),
    );
  }

  /**
   * Only items that carry a threshold can be below it, so the scan is limited
   * to those rather than every item in the catalogue.
   */
  private async lowStock(viewerUserId: string): Promise<OfficeDashboardResponse["lowStock"]> {
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
      viewerUserId,
    });

    return rows.slice(0, LOW_STOCK_LIMIT);
  }

  private async counts(): Promise<Omit<OfficeDashboardResponse["counts"], "pendingRequests">> {
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

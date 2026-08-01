import { randomUUID } from "node:crypto";

import type { JobDetailView, JobSummaryView } from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import {
  assigneesForJobs,
  jobSiteStock,
  listReservationsForJob,
  listTransactions,
} from "../persistence/read-models";

const SCHEMA = "stockcontrol" as const;

export interface NewJob {
  readonly number: string | null;
  readonly name: string;
  readonly customer: string;
}

export interface JobFilter {
  readonly status?: "Open" | "Closed" | undefined;
  /** Free text over the number, name and customer. */
  readonly search?: string | undefined;
  readonly assignedTo?: string | undefined;
  readonly jobId?: string | undefined;
}

export interface JobDetailOptions {
  readonly viewerUserId: string;
  readonly scopeActivityToViewer: boolean;
}

export class JobsService {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async list(filter: JobFilter = {}): Promise<readonly JobSummaryView[]> {
    let selection = this.database
      .withSchema(SCHEMA)
      .selectFrom("jobs")
      .innerJoin("locations", "locations.job_id", "jobs.id")
      .leftJoin("reservations", (join) =>
        join.onRef("reservations.job_id", "=", "jobs.id").on("reservations.status", "=", "Open"),
      );

    if (filter.status !== undefined) {
      selection = selection.where("jobs.status", "=", filter.status);
    }

    if (filter.jobId !== undefined) {
      selection = selection.where("jobs.id", "=", filter.jobId);
    }

    const search = filter.search?.trim();

    if (search !== undefined && search.length > 0) {
      const pattern = `%${search.toLowerCase()}%`;
      selection = selection.where((builder) =>
        builder.or([
          builder(sql<string>`lower(jobs.number)`, "like", pattern),
          builder(sql<string>`lower(jobs.name)`, "like", pattern),
          builder(sql<string>`lower(jobs.customer)`, "like", pattern),
        ]),
      );
    }

    /*
     * Assignment is a separate table, so the filter is an exists check rather
     * than another join: joining would multiply the reservation count rows.
     */
    if (filter.assignedTo !== undefined) {
      const assignedTo = filter.assignedTo;

      selection = selection.where((builder) =>
        builder.exists(
          builder
            .selectFrom("job_assignments")
            .select("job_assignments.job_id")
            .whereRef("job_assignments.job_id", "=", "jobs.id")
            .where("job_assignments.user_id", "=", assignedTo),
        ),
      );
    }

    const rows = await selection
      .select((builder) => [
        "jobs.id as id",
        "jobs.number as number",
        "jobs.name as name",
        "jobs.customer as customer",
        "jobs.status as status",
        "jobs.created_at as created_at",
        "jobs.closed_at as closed_at",
        "locations.id as job_site_location_id",
        builder.fn.count<string>("reservations.id").as("open_reservations"),
      ])
      .groupBy([
        "jobs.id",
        "jobs.number",
        "jobs.name",
        "jobs.customer",
        "jobs.status",
        "jobs.created_at",
        "jobs.closed_at",
        "locations.id",
      ])
      .orderBy("jobs.number")
      .execute();

    const assignees = await assigneesForJobs(
      this.database,
      rows.map((row) => row.id),
    );

    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      name: row.name,
      customer: row.customer,
      status: row.status,
      jobSiteLocationId: row.job_site_location_id,
      openReservationCount: Number(row.open_reservations),
      assignees: assignees.get(row.id) ?? [],
      createdAt: row.created_at.toISOString(),
      closedAt: row.closed_at?.toISOString() ?? null,
    }));
  }

  public async detail(jobId: string, viewer: JobDetailOptions): Promise<JobDetailView> {
    const [summary] = await this.list({ jobId });

    if (summary === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That job was not found." }),
      );
    }

    const [reservations, siteStock, transactions] = await Promise.all([
      listReservationsForJob(this.database, jobId),
      jobSiteStock(this.database, summary.jobSiteLocationId),
      listTransactions(this.database, {
        jobId,
        limit: 20,
        offset: 0,
        ...(viewer.scopeActivityToViewer ? { actorUserId: viewer.viewerUserId } : {}),
      }),
    ]);

    return {
      ...summary,
      reservations,
      jobSiteStock: siteStock,
      recentTransactions: transactions.rows,
    };
  }

  /** Creating a job also creates the one job-site location it owns. */
  public async create(input: NewJob, viewer: JobDetailOptions): Promise<JobDetailView> {
    const { name, customer } = input;
    const number = input.number ?? (await this.nextJobNumber());
    const jobId = randomUUID();

    try {
      await this.database.transaction().execute(async (tx) => {
        await tx
          .withSchema(SCHEMA)
          .insertInto("jobs")
          .values({ id: jobId, number, name, customer, status: "Open", closed_at: null })
          .execute();

        await tx
          .withSchema(SCHEMA)
          .insertInto("locations")
          .values({
            id: randomUUID(),
            code: number,
            name: `${name} site`,
            kind: "JobSite",
            job_id: jobId,
            is_active: true,
            /* A job site is somewhere stock sits, not somewhere you draw. */
            map_id: null,
            geometry: null,
            z_order: 0,
            search_aliases: JSON.stringify([]),
            derived_parent_id: null,
            archived_at: null,
          })
          .execute();
      });
    } catch (error: unknown) {
      const candidate = error as { readonly code?: string; readonly constraint?: string };

      if (candidate.code === "23505") {
        throw new ApplicationFailureException(
          validationFailed({ number: ["That job number is already in use."] }),
        );
      }

      throw error;
    }

    return this.detail(jobId, viewer);
  }

  /**
   * Assignment is idempotent: pressing the button twice is not an error, it
   * just means that person is on the job.
   */
  public async assign(jobId: string, userId: string, assignedByUserId: string): Promise<void> {
    await this.requireJobExists(jobId);
    await this.requireUserExists(userId);

    await this.database
      .withSchema(SCHEMA)
      .insertInto("job_assignments")
      .values({ job_id: jobId, user_id: userId, assigned_by_user_id: assignedByUserId })
      .onConflict((conflict) => conflict.columns(["job_id", "user_id"]).doNothing())
      .execute();
  }

  public async unassign(jobId: string, userId: string): Promise<void> {
    await this.database
      .withSchema(SCHEMA)
      .deleteFrom("job_assignments")
      .where("job_id", "=", jobId)
      .where("user_id", "=", userId)
      .execute();
  }

  private async requireJobExists(jobId: string): Promise<void> {
    const job = await this.database
      .withSchema(SCHEMA)
      .selectFrom("jobs")
      .select("id")
      .where("id", "=", jobId)
      .executeTakeFirst();

    if (job === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That job was not found." }),
      );
    }
  }

  private async requireUserExists(userId: string): Promise<void> {
    const user = await this.database
      .withSchema(SCHEMA)
      .selectFrom("users")
      .select("id")
      .where("id", "=", userId)
      .where("is_active", "=", true)
      .executeTakeFirst();

    if (user === undefined) {
      throw new ApplicationFailureException(
        validationFailed({ userId: ["Choose someone with an active account."] }),
      );
    }
  }

  private async nextJobNumber(): Promise<string> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("jobs")
      .select((builder) => [
        builder.fn
          .max<number>(sql<number>`nullif(regexp_replace(number, '\\D', '', 'g'), '')::bigint`)
          .as("highest"),
      ])
      .where("number", "like", "J-%")
      .executeTakeFirst();

    return `J-${String(Number(row?.highest ?? 1000) + 1)}`;
  }
}

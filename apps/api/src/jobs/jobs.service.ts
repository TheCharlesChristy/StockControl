import { randomUUID } from "node:crypto";

import type { JobDetailView, JobSummaryView } from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { jobSiteStock, listReservationsForJob, listTransactions } from "../persistence/read-models";

const SCHEMA = "stockcontrol" as const;

export interface NewJob {
  readonly number: string | null;
  readonly name: string;
  readonly customer: string;
}

export class JobsService {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async list(status?: "Open" | "Closed"): Promise<readonly JobSummaryView[]> {
    let selection = this.database
      .withSchema(SCHEMA)
      .selectFrom("jobs")
      .innerJoin("locations", "locations.job_id", "jobs.id")
      .leftJoin("reservations", (join) =>
        join.onRef("reservations.job_id", "=", "jobs.id").on("reservations.status", "=", "Open"),
      );

    if (status !== undefined) {
      selection = selection.where("jobs.status", "=", status);
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

    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      name: row.name,
      customer: row.customer,
      status: row.status,
      jobSiteLocationId: row.job_site_location_id,
      openReservationCount: Number(row.open_reservations),
      createdAt: row.created_at.toISOString(),
      closedAt: row.closed_at?.toISOString() ?? null,
    }));
  }

  public async detail(jobId: string): Promise<JobDetailView> {
    const summaries = await this.list();
    const summary = summaries.find((job) => job.id === jobId);

    if (summary === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That job was not found." }),
      );
    }

    const [reservations, siteStock, transactions] = await Promise.all([
      listReservationsForJob(this.database, jobId),
      jobSiteStock(this.database, summary.jobSiteLocationId),
      listTransactions(this.database, { jobId, limit: 20, offset: 0 }),
    ]);

    return {
      ...summary,
      reservations,
      jobSiteStock: siteStock,
      recentTransactions: transactions.rows,
    };
  }

  /** Creating a job also creates the one job-site location it owns. */
  public async create(input: NewJob): Promise<JobDetailView> {
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

    return this.detail(jobId);
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

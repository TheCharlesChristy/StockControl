import { createServer } from "node:http";

import type { Server, ServerResponse } from "node:http";

import type { ReadinessResponse } from "@stockcontrol/contracts";
import type { ReadinessChecks } from "@stockcontrol/module-system";

const DEFAULT_HEALTH_HOST = "0.0.0.0";
const DEFAULT_HEALTH_PORT = 3_001;

export interface WorkerHealthEnvironment {
  readonly WORKER_HEALTH_HOST?: string;
  readonly WORKER_HEALTH_PORT?: string;
  /** Railway supplies PORT to services, including private workers. */
  readonly PORT?: string;
}

export interface WorkerHealthConfiguration {
  readonly host: string;
  readonly port: number;
}

export const resolveWorkerHealthConfiguration = (
  environment: WorkerHealthEnvironment,
): WorkerHealthConfiguration => {
  const candidate =
    environment.WORKER_HEALTH_PORT ?? environment.PORT ?? String(DEFAULT_HEALTH_PORT);
  const port = Number(candidate);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid WORKER_HEALTH_PORT value: ${candidate}`);
  }

  return {
    host: environment.WORKER_HEALTH_HOST?.trim() || DEFAULT_HEALTH_HOST,
    port,
  };
};

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: Readonly<Record<string, unknown>>,
): void => {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
};

/**
 * Readiness now asks the database, not a boolean.
 *
 * The boolean was honest while the worker only logged a heartbeat: nothing
 * could be unready. A worker that claims jobs is different — one that cannot
 * reach PostgreSQL is claiming nothing while still reporting itself healthy,
 * which is exactly the outage an operator would never be told about.
 */
export class WorkerHealthEndpoint {
  private ready = false;
  private readonly server: Server;

  public constructor(
    private readonly configuration: WorkerHealthConfiguration,
    private readonly readiness?: ReadinessChecks,
  ) {
    this.server = createServer((request, response) => {
      if (request.method !== "GET") {
        response.writeHead(405, {
          allow: "GET",
          "cache-control": "no-store",
        });
        response.end();
        return;
      }

      if (request.url === "/health/live") {
        sendJson(response, 200, {
          service: "stockcontrol-worker",
          status: "live",
        });
        return;
      }

      if (request.url === "/health/ready") {
        void this.readinessReport().then((report) => {
          sendJson(response, report.status === "ready" ? 200 : 503, {
            service: "stockcontrol-worker",
            ...report,
          });
        });
        return;
      }

      sendJson(response, 404, {
        status: "not-found",
      });
    });
  }

  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        resolve();
      };

      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.configuration.port, this.configuration.host);
    });
  }

  public markReady(): void {
    this.ready = true;
  }

  private async readinessReport(): Promise<ReadinessResponse> {
    const timestamp = new Date().toISOString();

    /* Not started yet, or shutting down: no dependency check can change that. */
    if (!this.ready) {
      return { status: "not_ready", timestamp, checks: [] };
    }

    const checks = await Promise.all((this.readiness?.all() ?? []).map((check) => check.check()));

    return {
      status: checks.every(({ status }) => status === "ok") ? "ready" : "not_ready",
      timestamp,
      checks,
    };
  }

  public markNotReady(): void {
    this.ready = false;
  }

  public async close(): Promise<void> {
    this.ready = false;

    if (!this.server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  public getAddress(): { readonly host: string; readonly port: number } | undefined {
    const address = this.server.address();

    if (address === null || typeof address === "string") {
      return undefined;
    }

    return {
      host: address.address,
      port: address.port,
    };
  }
}

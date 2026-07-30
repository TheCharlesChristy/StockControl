import type { OnApplicationShutdown } from "@nestjs/common";

import type { VersionInformationProvider } from "@stockcontrol/module-system";
import type { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";

import type { WorkerHealthEndpoint } from "./worker-health";

const DEFAULT_HEARTBEAT_MILLISECONDS = 60_000;

export const parseHeartbeatMilliseconds = (candidate: string | undefined): number => {
  if (candidate === undefined || candidate.trim() === "") {
    return DEFAULT_HEARTBEAT_MILLISECONDS;
  }

  const parsed = Number(candidate);

  if (!Number.isInteger(parsed) || parsed < 1_000) {
    throw new Error(`Invalid WORKER_HEARTBEAT_MS value: ${candidate}. Minimum is 1000.`);
  }

  return parsed;
};

export class WorkerRuntime implements OnApplicationShutdown {
  private heartbeat: NodeJS.Timeout | undefined;
  private started = false;

  public constructor(
    private readonly context: CorrelationContext,
    private readonly logger: StructuredLogger,
    private readonly versionProvider: VersionInformationProvider,
    private readonly healthEndpoint: WorkerHealthEndpoint,
    private readonly heartbeatMilliseconds = parseHeartbeatMilliseconds(
      process.env.WORKER_HEARTBEAT_MS,
    ),
  ) {}

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error("The worker runtime has already started.");
    }

    await this.healthEndpoint.start();
    this.healthEndpoint.markReady();
    this.started = true;

    const version = this.versionProvider.get();
    this.logger.log({
      event: "worker.started",
      version: version.version,
      commit: version.commit,
      heartbeatMilliseconds: this.heartbeatMilliseconds,
    });

    this.heartbeat = setInterval(() => {
      this.context.run(this.context.createId(), () => {
        this.logger.log({ event: "worker.heartbeat" });
      });
    }, this.heartbeatMilliseconds);
  }

  public async onApplicationShutdown(signal?: string): Promise<void> {
    this.healthEndpoint.markNotReady();

    if (this.heartbeat !== undefined) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }

    await this.healthEndpoint.close();
    this.started = false;

    this.logger.log({
      event: "worker.stopped",
      signal: signal ?? "application",
    });
  }
}

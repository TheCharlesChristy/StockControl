import type { OnApplicationShutdown } from "@nestjs/common";

import type { VersionInformationProvider } from "@stockcontrol/module-system";
import type { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";

import type { RecognitionDispatcher } from "./recognition/recognition-dispatcher";
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
    private readonly recognition?: RecognitionDispatcher,
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

    this.recognition?.start();

    /*
     * The heartbeat now also reports queue depth. An idle worker and a worker
     * that cannot claim look identical in the logs otherwise, and the numbers
     * an operator alerts on — oldest ready age, dead-letter count — have to
     * come from somewhere on a schedule.
     */
    this.heartbeat = setInterval(() => {
      this.context.run(this.context.createId(), () => {
        this.logger.log({ event: "worker.heartbeat" });
        void this.recognition?.reportQueueDepth().catch(() => {
          this.logger.error({ event: "recognition.queue.depth_unavailable" });
        });
      });
    }, this.heartbeatMilliseconds);
  }

  /**
   * Stops in the order that loses the least work: refuse traffic, stop
   * claiming, wait for what is running, then hand its leases back so another
   * replica picks the work up immediately rather than after the lease expires.
   */
  public async onApplicationShutdown(signal?: string): Promise<void> {
    this.healthEndpoint.markNotReady();

    if (this.heartbeat !== undefined) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }

    if (this.recognition !== undefined) {
      await this.recognition.drain();
      await this.recognition.releaseHeldLeases();
    }

    await this.healthEndpoint.close();
    this.started = false;

    this.logger.log({
      event: "worker.stopped",
      signal: signal ?? "application",
    });
  }
}

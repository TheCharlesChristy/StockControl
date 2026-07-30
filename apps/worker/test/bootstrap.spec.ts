import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const runtime = {
    start: vi.fn<() => Promise<void>>(),
  };
  const application = {
    close: vi.fn<() => Promise<void>>(),
    enableShutdownHooks: vi.fn(),
    get: vi.fn((token: symbol) =>
      token.description === "worker.runtime"
        ? runtime
        : {
            error: vi.fn(),
            log: vi.fn(),
            warn: vi.fn(),
          },
    ),
    useLogger: vi.fn(),
  };

  return {
    application,
    createApplicationContext: vi.fn(() => Promise.resolve(application)),
    runtime,
  };
});

vi.mock("@nestjs/core", () => ({
  NestFactory: {
    createApplicationContext: mocks.createApplicationContext,
  },
}));

import { startWorker } from "../src/bootstrap";

describe("worker bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtime.start.mockResolvedValue();
    mocks.application.close.mockResolvedValue();
  });

  it("configures shutdown hooks and starts the observable runtime", async () => {
    await expect(startWorker()).resolves.toBe(mocks.application);

    expect(mocks.application.useLogger).toHaveBeenCalledOnce();
    expect(mocks.application.enableShutdownHooks).toHaveBeenCalledOnce();
    expect(mocks.runtime.start).toHaveBeenCalledOnce();
    expect(mocks.application.close).not.toHaveBeenCalled();
  });

  it("closes the application context when runtime startup fails", async () => {
    const startError = new Error("health listener failed");
    mocks.runtime.start.mockRejectedValue(startError);

    await expect(startWorker()).rejects.toBe(startError);
    expect(mocks.application.close).toHaveBeenCalledOnce();
  });

  it("reports both errors when startup and cleanup fail", async () => {
    const startError = new Error("health listener failed");
    const closeError = new Error("cleanup failed");
    mocks.runtime.start.mockRejectedValue(startError);
    mocks.application.close.mockRejectedValue(closeError);

    await expect(startWorker()).rejects.toMatchObject({
      cause: closeError,
      errors: [startError, closeError],
    });
  });
});

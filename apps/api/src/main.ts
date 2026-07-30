import { startApi } from "./bootstrap";

void startApi().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "fatal",
      service: "stockcontrol-api",
      event: "api.bootstrap.failed",
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
    })}\n`,
  );
  process.exitCode = 1;
});

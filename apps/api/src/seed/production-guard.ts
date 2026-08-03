export class DemoSeedDisabledError extends Error {
  public constructor() {
    super("The destructive demo seed is disabled when NODE_ENV=production.");
    this.name = "DemoSeedDisabledError";
  }
}

export const assertDemoSeedAllowed = (
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  if (environment.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new DemoSeedDisabledError();
  }
};

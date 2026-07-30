import type { VersionInformation, VersionInformationProvider } from "@stockcontrol/module-system";

interface VersionEnvironment {
  readonly APP_VERSION?: string;
  readonly BUILD_TIMESTAMP?: string;
  readonly GIT_SHA?: string;
}

const nonEmptyOr = (value: string | undefined, fallback: string): string =>
  value?.trim() ? value.trim() : fallback;

export class EnvironmentVersionProvider implements VersionInformationProvider {
  public constructor(
    private readonly service: string,
    private readonly environment: VersionEnvironment = process.env,
  ) {}

  public get(): VersionInformation {
    return {
      service: this.service,
      version: nonEmptyOr(this.environment.APP_VERSION, "0.0.0-dev"),
      commit: nonEmptyOr(this.environment.GIT_SHA, "unknown"),
      builtAt: this.environment.BUILD_TIMESTAMP?.trim() || null,
    };
  }
}

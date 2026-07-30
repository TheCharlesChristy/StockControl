export interface VersionInformation {
  readonly service: string;
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string | null;
}

export interface VersionInformationProvider {
  get(): VersionInformation;
}

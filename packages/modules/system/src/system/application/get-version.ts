import type { VersionResponse } from "@stockcontrol/contracts";

import type { VersionInformationProvider } from "../ports/version-information";

export class GetVersion {
  public constructor(private readonly versionInformation: VersionInformationProvider) {}

  public execute(): VersionResponse {
    return this.versionInformation.get();
  }
}

import { HttpException } from "@nestjs/common";

import {
  applicationFailureStatus,
  GENERIC_INTERNAL_FAILURE_DETAIL,
  type ApplicationFailure,
} from "@stockcontrol/contracts";

/**
 * Carries an application failure across the HTTP boundary.
 *
 * A route handler translates a failed application result into this exception
 * and the problem-details filter renders it. The handler never chooses a
 * status code or an error code itself, so one vocabulary describes a failure
 * whether it is returned, thrown, or logged.
 */
export class ApplicationFailureException extends HttpException {
  public constructor(public readonly failure: ApplicationFailure) {
    /*
     * The exception message is used only by framework logging. An unexpected
     * failure keeps its generic message here so a log line copied into a
     * response, or an error reporter reading `message`, cannot disclose
     * internal state.
     */
    super(
      failure.kind === "InternalFailure" ? GENERIC_INTERNAL_FAILURE_DETAIL : failure.detail,
      applicationFailureStatus(failure),
    );
    this.name = "ApplicationFailureException";
  }
}

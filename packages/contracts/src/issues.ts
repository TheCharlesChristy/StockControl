/** The user-facing issue report sent to the API. */
export interface ReportIssueRequest {
  readonly title: string;
  readonly description: string;
  readonly page: string;
}

export interface ReportIssueResponse {
  readonly issueUrl: string;
}

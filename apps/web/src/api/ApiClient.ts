import type {
  CreateItemRequest,
  CreateJobRequest,
  CreateLocationRequest,
  CreateUserRequest,
  DashboardResponse,
  ItemDetailView,
  ItemListResponse,
  JobDetailView,
  JobListResponse,
  JobStatus,
  LocationListResponse,
  StockOperationResponse,
  TransactionListResponse,
  UpdateUserRequest,
  UserListResponse,
  UserView,
} from "@stockcontrol/contracts";

/**
 * One typed client for the whole API. Every screen goes through it, so the
 * request shape, the error shape and the credential handling are decided once.
 */

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

/** A failure the server described in Problem Details form. */
export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors: FieldErrors | undefined = undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The first message for a field, for putting next to the input it belongs to. */
  public fieldError(field: string): string | undefined {
    return this.errors?.[field]?.[0];
  }

  public get isValidation(): boolean {
    return this.status === 422;
  }

  public get isPermissionDenied(): boolean {
    return this.status === 403;
  }

  public get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

interface ProblemBody {
  readonly detail?: unknown;
  readonly code?: unknown;
  readonly errors?: unknown;
}

function toApiError(status: number, body: unknown): ApiError {
  const problem = (typeof body === "object" && body !== null ? body : {}) as ProblemBody;
  const detail =
    typeof problem.detail === "string" && problem.detail.length > 0
      ? problem.detail
      : "Something went wrong. Please try again.";
  const code = typeof problem.code === "string" ? problem.code : `http.${String(status)}`;
  const errors =
    typeof problem.errors === "object" && problem.errors !== null
      ? (problem.errors as FieldErrors)
      : undefined;

  return new ApiError(status, code, detail, errors);
}

type Query = Readonly<Record<string, string | number | undefined>>;

function toQueryString(query: Query | undefined): string {
  if (query === undefined) {
    return "";
  }

  const parameters = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && String(value).length > 0) {
      parameters.set(key, String(value));
    }
  }

  const rendered = parameters.toString();
  return rendered.length === 0 ? "" : `?${rendered}`;
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ApiClient {
  public constructor(
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = "/api/v1",
  ) {}

  private async send<Result>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    options: {
      readonly body?: unknown;
      readonly query?: Query;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<Result> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}${path}${toQueryString(options.query)}`,
      {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );

    const text = await response.text();
    const parsed: unknown = text.length === 0 ? undefined : JSON.parse(text);

    if (!response.ok) {
      throw toApiError(response.status, parsed);
    }

    return parsed as Result;
  }

  public dashboard(signal?: AbortSignal): Promise<DashboardResponse> {
    return this.send("GET", "/dashboard", { ...(signal === undefined ? {} : { signal }) });
  }

  public listItems(
    query: { readonly search?: string; readonly limit?: number; readonly offset?: number },
    signal?: AbortSignal,
  ): Promise<ItemListResponse> {
    return this.send("GET", "/items", {
      query,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public async getItem(id: string, signal?: AbortSignal): Promise<ItemDetailView> {
    const { item } = await this.send<{ item: ItemDetailView }>("GET", `/items/${id}`, {
      ...(signal === undefined ? {} : { signal }),
    });

    return item;
  }

  public async createItem(body: CreateItemRequest): Promise<ItemDetailView> {
    const { item } = await this.send<{ item: ItemDetailView }>("POST", "/items", { body });

    return item;
  }

  public listLocations(signal?: AbortSignal): Promise<LocationListResponse> {
    return this.send("GET", "/locations", { ...(signal === undefined ? {} : { signal }) });
  }

  public createLocation(body: CreateLocationRequest): Promise<unknown> {
    return this.send("POST", "/locations", { body });
  }

  public receive(body: {
    readonly itemId: string;
    readonly locationId: string;
    readonly quantity: string;
  }): Promise<StockOperationResponse> {
    return this.send("POST", "/stock/receive", { body });
  }

  public issue(body: {
    readonly itemId: string;
    readonly locationId: string;
    readonly quantity: string;
    readonly jobId?: string | null;
  }): Promise<StockOperationResponse> {
    return this.send("POST", "/stock/issue", { body });
  }

  public transfer(body: {
    readonly itemId: string;
    readonly fromLocationId: string;
    readonly toLocationId: string;
    readonly quantity: string;
  }): Promise<StockOperationResponse> {
    return this.send("POST", "/stock/transfer", { body });
  }

  public adjust(body: {
    readonly itemId: string;
    readonly locationId: string;
    readonly countedQuantity: string;
    readonly reason: string;
  }): Promise<StockOperationResponse> {
    return this.send("POST", "/stock/adjust", { body });
  }

  public listJobs(status?: JobStatus, signal?: AbortSignal): Promise<JobListResponse> {
    return this.send("GET", "/jobs", {
      ...(status === undefined ? {} : { query: { status } }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public async getJob(id: string, signal?: AbortSignal): Promise<JobDetailView> {
    const { job } = await this.send<{ job: JobDetailView }>("GET", `/jobs/${id}`, {
      ...(signal === undefined ? {} : { signal }),
    });

    return job;
  }

  public async createJob(body: CreateJobRequest): Promise<JobDetailView> {
    const { job } = await this.send<{ job: JobDetailView }>("POST", "/jobs", { body });

    return job;
  }

  public async closeJob(id: string): Promise<JobDetailView> {
    const { job } = await this.send<{ job: JobDetailView }>("POST", `/jobs/${id}/close`);

    return job;
  }

  public reserve(
    jobId: string,
    body: { readonly itemId: string; readonly quantity: string },
  ): Promise<StockOperationResponse> {
    return this.send("POST", `/jobs/${jobId}/reservations`, { body });
  }

  public collect(
    reservationId: string,
    body: { readonly sourceLocationId: string; readonly quantity: string },
  ): Promise<StockOperationResponse> {
    return this.send("POST", `/reservations/${reservationId}/collect`, { body });
  }

  public release(
    reservationId: string,
    body: { readonly reason: string },
  ): Promise<StockOperationResponse> {
    return this.send("POST", `/reservations/${reservationId}/release`, { body });
  }

  public listTransactions(
    query: {
      readonly itemId?: string;
      readonly jobId?: string;
      readonly actorUserId?: string;
      readonly from?: string;
      readonly to?: string;
      readonly limit?: number;
      readonly offset?: number;
    },
    signal?: AbortSignal,
  ): Promise<TransactionListResponse> {
    return this.send("GET", "/transactions", {
      query,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public listUsers(signal?: AbortSignal): Promise<UserListResponse> {
    return this.send("GET", "/users", { ...(signal === undefined ? {} : { signal }) });
  }

  public async createUser(body: CreateUserRequest): Promise<UserView> {
    const { user } = await this.send<{ user: UserView }>("POST", "/users", { body });

    return user;
  }

  public async updateUser(id: string, body: UpdateUserRequest): Promise<UserView> {
    const { user } = await this.send<{ user: UserView }>("PATCH", `/users/${id}`, { body });

    return user;
  }
}

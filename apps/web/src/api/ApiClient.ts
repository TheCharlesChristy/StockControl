import type {
  CreateItemRequest,
  CreateJobRequest,
  CreateMapRequest,
  CreateStockRequestRequest,
  CreateUserRequest,
  DashboardResponse,
  ItemDetailView,
  ItemListResponse,
  JobDetailView,
  JobListResponse,
  JobStatus,
  LocationListResponse,
  StockOperationResponse,
  StockRequestListResponse,
  StockRequestStatus,
  StockRequestView,
  TransactionListResponse,
  UpdateItemRequest,
  UpdateUserRequest,
  UserActivityResponse,
  UserListResponse,
  UserView,
  LocationSearchResult,
  MapSummaryView,
  MapView,
  SaveMapRequest,
  UploadFloorPlanRequest,
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

  /**
   * Whether every part of this failure is already spoken for by a field.
   *
   * A form that shows "Enter a location." under the empty select does not also
   * need "Validation failed" shouted above it — the banner adds a word nobody
   * outside software uses and says less than the message beneath it. A dialog
   * uses this to keep the summary for failures the fields cannot explain.
   */
  public get hasFieldErrors(): boolean {
    return Object.keys(this.errors ?? {}).length > 0;
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
    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
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

  public async updateItem(id: string, body: UpdateItemRequest): Promise<ItemDetailView> {
    const { item } = await this.send<{ item: ItemDetailView }>("PATCH", `/items/${id}`, { body });

    return item;
  }

  /** Resolves a scanned reference, barcode or part number to its item. */
  public async lookupItem(code: string, signal?: AbortSignal): Promise<ItemDetailView> {
    const { item } = await this.send<{ item: ItemDetailView }>("GET", "/items/lookup", {
      query: { code },
      ...(signal === undefined ? {} : { signal }),
    });

    return item;
  }

  public listLocations(signal?: AbortSignal): Promise<LocationListResponse> {
    return this.send("GET", "/locations", { ...(signal === undefined ? {} : { signal }) });
  }

  public async archiveLocation(id: string): Promise<void> {
    await this.send("POST", `/locations/${id}/archive`);
  }

  public async deleteLocation(id: string): Promise<void> {
    await this.send("DELETE", `/locations/${id}`);
  }

  public searchLocations(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly LocationSearchResult[]> {
    return this.send("GET", "/locations/search", {
      query: { query },
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public listMaps(signal?: AbortSignal): Promise<readonly MapSummaryView[]> {
    return this.send("GET", "/maps", { ...(signal === undefined ? {} : { signal }) });
  }

  public getMap(mapId: string, signal?: AbortSignal): Promise<MapView> {
    return this.send("GET", `/maps/${mapId}`, { ...(signal === undefined ? {} : { signal }) });
  }

  public createMap(body: CreateMapRequest): Promise<MapView> {
    return this.send("POST", "/maps", { body });
  }

  public saveMap(mapId: string, body: SaveMapRequest): Promise<MapView> {
    return this.send("PUT", `/maps/${mapId}`, { body });
  }

  public uploadFloorPlan(mapId: string, body: UploadFloorPlanRequest): Promise<MapView> {
    return this.send("POST", `/maps/${mapId}/background`, { body });
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

  public listJobs(
    query: {
      readonly status?: JobStatus | undefined;
      readonly search?: string | undefined;
      readonly assignedTo?: string | undefined;
    } = {},
    signal?: AbortSignal,
  ): Promise<JobListResponse> {
    return this.send("GET", "/jobs", {
      query,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public async assignJob(jobId: string, userId: string): Promise<JobDetailView> {
    const { job } = await this.send<{ job: JobDetailView }>("POST", `/jobs/${jobId}/assignments`, {
      body: { userId },
    });

    return job;
  }

  public async unassignJob(jobId: string, userId: string): Promise<JobDetailView> {
    const { job } = await this.send<{ job: JobDetailView }>(
      "DELETE",
      `/jobs/${jobId}/assignments/${userId}`,
    );

    return job;
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

  public listStockRequests(
    query: {
      readonly status?: StockRequestStatus | undefined;
      readonly mine?: string | undefined;
      readonly itemId?: string | undefined;
      readonly jobId?: string | undefined;
      readonly limit?: number;
      readonly offset?: number;
    } = {},
    signal?: AbortSignal,
  ): Promise<StockRequestListResponse> {
    return this.send("GET", "/stock-requests", {
      query,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public async createStockRequest(body: CreateStockRequestRequest): Promise<StockRequestView> {
    const { request } = await this.send<{ request: StockRequestView }>("POST", "/stock-requests", {
      body,
    });

    return request;
  }

  public async approveStockRequest(
    id: string,
    body: { readonly quantity?: string; readonly decisionNote?: string | null } = {},
  ): Promise<StockRequestView> {
    const { request } = await this.send<{ request: StockRequestView }>(
      "POST",
      `/stock-requests/${id}/approve`,
      { body },
    );

    return request;
  }

  public async rejectStockRequest(id: string, decisionNote: string): Promise<StockRequestView> {
    const { request } = await this.send<{ request: StockRequestView }>(
      "POST",
      `/stock-requests/${id}/reject`,
      { body: { decisionNote } },
    );

    return request;
  }

  public async cancelStockRequest(id: string): Promise<StockRequestView> {
    const { request } = await this.send<{ request: StockRequestView }>(
      "POST",
      `/stock-requests/${id}/cancel`,
    );

    return request;
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

  public async deleteUser(id: string): Promise<void> {
    await this.send("DELETE", `/users/${id}`);
  }

  public userActivity(id: string, signal?: AbortSignal): Promise<UserActivityResponse> {
    return this.send("GET", `/users/${id}/activity`, {
      ...(signal === undefined ? {} : { signal }),
    });
  }
}

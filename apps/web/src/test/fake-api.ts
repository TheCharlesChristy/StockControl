import type {
  EngineerDashboardResponse,
  HierarchyNodeView,
  HierarchyTreeResponse,
  ItemDetailView,
  ItemListResponse,
  ItemSummaryView,
  JobDetailView,
  JobListResponse,
  LocationListResponse,
  MapRegionInput,
  MapRegionView,
  MapSnapshot,
  MapSummaryView,
  OfficeDashboardResponse,
  SaveMapRequest,
  StockRequestListResponse,
  StockRequestView,
  TransactionListResponse,
  TransactionView,
  UserListResponse,
} from "@stockcontrol/contracts";

import { ApiClient } from "../api/ApiClient";

/**
 * Canned API responses served through a stub fetch, so tests exercise the real
 * ApiClient — its URL building, its error mapping — rather than a hand-written
 * double that could drift away from it.
 */

export const testItem: ItemSummaryView = {
  id: "item-1",
  reference: "ITM-0001",
  name: "M6 × 30 mm zinc-plated hex bolt",
  unit: "ea",
  barcode: "5010000000011",
  partNumber: "PN-100037",
  lowStockThreshold: "100.000",
  isActive: true,
  onHand: "420.000",
  inStores: "400.000",
  atJobSites: "20.000",
  reserved: "50.000",
  reservedForYou: "30.000",
  available: "350.000",
  belowThreshold: false,
};

export const testTransaction: TransactionView = {
  id: "transaction-1",
  kind: "Receive",
  itemId: testItem.id,
  itemReference: testItem.reference,
  itemName: testItem.name,
  unit: "ea",
  quantity: "420.000",
  fromLocationCode: null,
  toLocationCode: "MAIN-A1",
  jobNumber: null,
  reason: null,
  actorUserId: "test-office",
  actorName: "Olivia Desk",
  occurredAt: "2026-07-29T09:00:00.000Z",
};

export const testItemDetail: ItemDetailView = {
  ...testItem,
  balances: [
    {
      locationId: "location-1",
      locationCode: "MAIN-A1",
      locationName: "Main store, aisle A, bay 1",
      kind: "Store",
      quantity: "400.000",
    },
    {
      locationId: "location-job",
      locationCode: "J-1001",
      locationName: "Retail unit fit-out site",
      kind: "JobSite",
      quantity: "20.000",
    },
  ],
  recentTransactions: [testTransaction],
};

export const testJob: JobDetailView = {
  id: "job-1",
  number: "J-1001",
  name: "Retail unit fit-out",
  customer: "Northgate Retail",
  status: "Open",
  jobSiteLocationId: "location-job",
  openReservationCount: 1,
  assignees: [{ userId: "test-engineer", displayName: "Sam Field", role: "Engineer" }],
  createdAt: "2026-07-20T09:00:00.000Z",
  closedAt: null,
  reservations: [
    {
      id: "reservation-1",
      itemId: testItem.id,
      itemReference: testItem.reference,
      itemName: testItem.name,
      unit: "ea",
      quantityReserved: "50.000",
      quantityCollected: "20.000",
      quantityOutstanding: "30.000",
      status: "Open",
      createdById: "test-engineer",
      createdByName: "Sam Field",
      createdAt: "2026-07-21T09:00:00.000Z",
    },
  ],
  jobSiteStock: [
    {
      locationId: "location-job",
      locationCode: "J-1001",
      locationName: "ITM-0001 — M6 × 30 mm zinc-plated hex bolt",
      kind: "JobSite",
      quantity: "20.000",
    },
  ],
  recentTransactions: [testTransaction],
};

export const testStockRequest: StockRequestView = {
  id: "request-1",
  reference: "REQ-0001",
  itemId: testItem.id,
  itemReference: testItem.reference,
  itemName: testItem.name,
  unit: "ea",
  jobId: "job-1",
  jobNumber: "J-1001",
  jobName: "Retail unit fit-out",
  quantity: "25.000",
  note: "Running short on site",
  status: "Pending",
  requestedById: "test-engineer",
  requestedByName: "Sam Field",
  decidedByName: null,
  decisionNote: null,
  reservationId: null,
  createdAt: "2026-07-28T09:00:00.000Z",
  decidedAt: null,
};

const dashboardReservation = {
  ...testJob.reservations[0]!,
  jobId: testJob.id,
  jobNumber: testJob.number,
  jobName: testJob.name,
};

/*
 * The dashboard payload differs by role, so the fake serves whichever shape the
 * test's signed-in role would really receive.
 */
export const officeDashboard: OfficeDashboardResponse = {
  role: "Office",
  lowStock: [{ ...testItem, id: "item-low", reference: "ITM-0099", belowThreshold: true }],
  upcomingJobs: [testJob],
  openReservations: [dashboardReservation],
  myReservations: [dashboardReservation],
  pendingRequests: [testStockRequest],
  recentTransactions: [testTransaction],
  counts: { items: 235, openJobs: 3, openReservations: 18, pendingRequests: 1 },
};

export const engineerDashboard: EngineerDashboardResponse = {
  role: "Engineer",
  myJobs: [{ ...testJob, jobSiteStock: testJob.jobSiteStock }],
  myReservations: [dashboardReservation],
  myRequests: [testStockRequest],
};

const items: ItemListResponse = { rows: [testItem], total: 1, limit: 25, offset: 0 };
const locations: LocationListResponse = {
  locations: [
    {
      id: "location-1",
      code: "MAIN-A1",
      name: "Main store, aisle A, bay 1",
      kind: "Store",
      jobId: null,
      isActive: true,
    },
  ],
};
const jobs: JobListResponse = { jobs: [testJob] };
const stockRequests: StockRequestListResponse = {
  rows: [testStockRequest],
  total: 1,
  limit: 50,
  offset: 0,
};
const transactions: TransactionListResponse = {
  rows: [testTransaction],
  total: 1,
  limit: 50,
  offset: 0,
};
const users: UserListResponse = {
  users: [
    {
      id: "test-admin",
      email: "admin@example.com",
      displayName: "Admin User",
      role: "Admin",
      isActive: true,
      createdAt: "2026-07-01T09:00:00.000Z",
    },
  ],
};

/*
 * Locations and building maps. Region identities are canonical UUIDs because
 * that is what the server's value objects accept, and the editor now generates
 * ids for new regions client-side.
 */
export const testBranchId = "11111111-1111-4111-8111-111111111111";
export const testBuildingId = "22222222-2222-4222-8222-222222222222";
export const testAreaId = "33333333-3333-4333-8333-333333333333";
export const testAisleId = "44444444-4444-4444-8444-444444444444";
export const testMapId = "55555555-5555-4555-8555-555555555555";
export const testRectangleRegionId = "66666666-6666-4666-8666-666666666666";
export const testPolygonRegionId = "77777777-7777-4777-8777-777777777777";

const hierarchyNode = (
  overrides: Partial<HierarchyNodeView> & Pick<HierarchyNodeView, "id" | "code" | "name">,
): HierarchyNodeView => ({
  nodeKind: "Area",
  operationalKind: "Storage",
  parentId: testBuildingId,
  branchId: testBranchId,
  buildingId: testBuildingId,
  status: "Active",
  generalFulfilmentEnabled: true,
  children: [],
  ...overrides,
});

export const testArea = hierarchyNode({ id: testAreaId, code: "MAIN-A", name: "Aisle A" });
export const testAisle = hierarchyNode({
  id: testAisleId,
  code: "MAIN-B",
  name: "Aisle B",
  nodeKind: "Aisle",
});
export const testBuilding = hierarchyNode({
  id: testBuildingId,
  code: "MAIN",
  name: "Main warehouse",
  nodeKind: "Building",
  parentId: testBranchId,
  children: [testArea, testAisle],
});
export const testBranch = hierarchyNode({
  id: testBranchId,
  code: "BR",
  name: "Northgate branch",
  nodeKind: "Branch",
  operationalKind: "Container",
  parentId: null,
  buildingId: null,
  children: [testBuilding],
});

export const testHierarchyTree: HierarchyTreeResponse = {
  root: testBranch,
  buildings: [testBuilding],
  capabilities: ["manageLocations"],
};

const availableStock: MapRegionView["stock"] = {
  status: "Available",
  colour: "#2E7D32",
  text: "Available",
  icon: "check-circle",
  itemCount: 4,
  quantity: "120",
};

export const testRectangleRegion: MapRegionView = {
  id: testRectangleRegionId,
  displayName: "Aisle A bays",
  hierarchyNodeId: testAreaId,
  parentRegionId: null,
  geometry: { kind: "Rectangle", x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
  zOrder: 1,
  searchAliases: ["bay row"],
  status: "Active",
  stock: availableStock,
};

export const testPolygonRegion: MapRegionView = {
  id: testPolygonRegionId,
  displayName: "Aisle B corner",
  hierarchyNodeId: testAisleId,
  parentRegionId: null,
  geometry: {
    kind: "Polygon",
    points: [
      { x: 0.6, y: 0.6 },
      { x: 0.9, y: 0.6 },
      { x: 0.75, y: 0.9 },
    ],
  },
  zOrder: 2,
  searchAliases: [],
  status: "Active",
  stock: { ...availableStock, status: "LowStock", colour: "#ED6C02", text: "Low stock" },
};

export const testMapSnapshot: MapSnapshot = {
  id: testMapId,
  buildingId: testBuildingId,
  building: testBuilding,
  status: "Active",
  revision: 3,
  background: { kind: "Blank" },
  hierarchy: [testBuilding],
  regions: [testRectangleRegion, testPolygonRegion],
  capabilities: ["manageLocations"],
};

export const testMapSummary: MapSummaryView = {
  id: testMapId,
  buildingId: testBuildingId,
  buildingCode: "MAIN",
  buildingName: "Main warehouse",
  status: "Active",
  revision: 3,
  background: { kind: "Blank" },
  regionCount: 2,
};

/** Turns a save payload back into a snapshot, the way the API would. */
function savedSnapshot(regions: readonly MapRegionInput[], revision: number): MapSnapshot {
  return {
    ...testMapSnapshot,
    revision: revision + 1,
    regions: regions.map((region, index) => ({
      id: region.id ?? `server-${String(index)}`,
      displayName: region.displayName,
      hierarchyNodeId: region.hierarchyNodeId,
      parentRegionId: region.parentRegionId ?? null,
      geometry: region.geometry,
      zOrder: region.zOrder,
      searchAliases: region.searchAliases ?? [],
      status: region.status ?? "Active",
      stock: availableStock,
    })),
  };
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Builds an ApiClient whose every GET resolves against the canned data above. */
export function createFakeApiClient(
  overrides: Readonly<Record<string, unknown>> = {},
  onRequest?: (request: RecordedRequest) => void,
): ApiClient {
  return new ApiClient((input, init) => {
    /* The client only ever passes a string path, so this is the whole surface. */
    const url = typeof input === "string" ? input : String((input as URL).href);
    const path = url.replace("/api/v1", "").split("?")[0] ?? "";
    const method = init?.method ?? "GET";
    const rawBody = init?.body;
    const body: unknown = typeof rawBody === "string" ? JSON.parse(rawBody) : undefined;
    onRequest?.({ method, path, body });

    for (const [pattern, payload] of Object.entries(overrides)) {
      if (path === pattern) {
        return Promise.resolve(jsonResponse(payload));
      }
    }

    if (path === "/locations/tree") {
      return Promise.resolve(jsonResponse(testHierarchyTree));
    }
    if (path === "/locations/search") {
      const query = url.includes("query=") ? decodeURIComponent(url.split("query=")[1] ?? "") : "";
      const matches = [testArea, testAisle].filter((node) =>
        `${node.name} ${node.code}`.toLowerCase().includes(query.toLowerCase()),
      );
      return Promise.resolve(
        jsonResponse(
          query.length === 0
            ? []
            : matches.map((node) => ({
                location: node,
                regionId: node.id === testAreaId ? testRectangleRegionId : testPolygonRegionId,
                mapId: testMapId,
                matchedOn: "name",
              })),
        ),
      );
    }
    if (path === "/maps") {
      return Promise.resolve(jsonResponse([testMapSummary]));
    }
    if (path === `/maps/${testMapId}` && method === "PUT") {
      const request = body as SaveMapRequest;
      return Promise.resolve(
        jsonResponse(savedSnapshot(request.regions, request.expectedRevision)),
      );
    }
    if (path.startsWith("/maps/")) {
      return Promise.resolve(jsonResponse(testMapSnapshot));
    }
    if (path === "/dashboard") {
      return Promise.resolve(jsonResponse(officeDashboard));
    }
    if (path === "/stock-requests") {
      return Promise.resolve(jsonResponse(stockRequests));
    }
    if (path === "/items") {
      return Promise.resolve(jsonResponse(items));
    }
    if (path === "/items/lookup" || path.startsWith("/items/")) {
      return Promise.resolve(jsonResponse({ item: testItemDetail }));
    }
    if (path === "/locations") {
      return Promise.resolve(jsonResponse(locations));
    }
    if (path === "/jobs") {
      return Promise.resolve(jsonResponse(jobs));
    }
    if (path.startsWith("/jobs/")) {
      return Promise.resolve(jsonResponse({ job: testJob }));
    }
    if (path === "/transactions") {
      return Promise.resolve(jsonResponse(transactions));
    }
    if (path === "/users") {
      return Promise.resolve(jsonResponse(users));
    }
    if (path.endsWith("/activity")) {
      return Promise.resolve(
        jsonResponse({
          user: users.users[0],
          recentTransactions: [testTransaction],
          openReservations: testJob.reservations,
          stockRequests: [testStockRequest],
          counts: { transactions: 1, openReservations: 1, pendingRequests: 1 },
        }),
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify({ detail: `No fake for ${path}`, code: "test.missing" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

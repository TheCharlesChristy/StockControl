import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CommitCaptureEntryResponse,
  ItemDetailView,
  LocationListResponse,
  RecognitionSessionSummaryView,
  RecognitionSessionView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiClient } from "../../api/ApiClient";
import { ApiProvider } from "../../api/ApiContext";
import type { BarcodeProvider } from "./barcode/provider";
import { saveCaptureProgress } from "./capture-storage";
import { StockCapturePage } from "./StockCapturePage";

const noBarcodes: BarcodeProvider = {
  readerVersion: "test-decoder",
  decode: () => Promise.resolve([]),
};

const item: ItemDetailView = {
  id: "item-1",
  reference: "ITM-0001",
  name: "Widget",
  unit: "ea",
  barcode: "5012345678900",
  partNumber: null,
  lowStockThreshold: null,
  isActive: true,
  onHand: "0",
  inStores: "0",
  atJobSites: "0",
  reserved: "0",
  reservedForYou: "0",
  available: "0",
  belowThreshold: false,
  coverPhotoUrl: null,
  balances: [],
  recentTransactions: [],
  photos: [],
};

const locations: LocationListResponse = {
  locations: [
    {
      id: "location-1",
      code: "MAIN-A1",
      name: "Main store",
      kind: "Store",
      jobId: null,
      isActive: true,
      path: "Main store",
    },
  ],
};

const openBatch: StockCaptureBatchView = {
  id: "batch-1",
  status: "Open",
  defaultLocationId: "location-1",
  createdAt: "2026-08-10T09:00:00.000Z",
  closedAt: null,
  sessions: [],
  committedEntryCount: 0,
};

const exactMatchSessionSummary: RecognitionSessionSummaryView = {
  id: "session-1",
  status: "ReviewReady",
  photoCount: 0,
  createdAt: "2026-08-10T09:05:00.000Z",
  expiresAt: "2026-08-10T15:05:00.000Z",
  committedItemId: null,
  failureCode: null,
};

const exactMatchSessionView: RecognitionSessionView = {
  ...exactMatchSessionSummary,
  batchId: openBatch.id,
  candidates: [
    {
      id: "candidate-1",
      rank: 1,
      kind: "InternalItem",
      confidence: "Strong",
      item,
      identity: {
        manufacturer: null,
        name: item.name,
        partNumber: null,
        barcode: item.barcode,
        unit: item.unit,
        variantAttributes: [],
      },
      selectable: true,
      evidence: [
        {
          stage: "Barcode",
          imageOrdinals: [1],
          summary: "Barcode matched exactly",
          sourceUrl: null,
        },
      ],
    },
  ],
  stageReports: [],
  recommendManualEntry: false,
};

const commitResult: CommitCaptureEntryResponse = {
  item,
  transactionId: "txn-1",
  createdItem: false,
  batch: { ...openBatch, committedEntryCount: 1 },
};

/**
 * Every server response this journey needs, canned by exact path. No
 * candidate-fusion or upload machinery is exercised here — an exact barcode
 * match resolves without a photograph ever leaving the browser, which is
 * exactly the fast path this test is built to cover.
 */
function createStockCaptureApi(onRequest?: (method: string, path: string) => void): ApiClient {
  const json = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  return new ApiClient((input, init) => {
    const url = typeof input === "string" ? input : String((input as URL).href);
    const path = url.replace("/api/v1", "").split("?")[0] ?? "";
    const method = init?.method ?? "GET";
    onRequest?.(method, path);

    if (path === "/locations" && method === "GET") return Promise.resolve(json(locations));
    if (path === "/stock-capture/batches" && method === "POST") {
      return Promise.resolve(json({ batch: openBatch }));
    }
    if (path === `/stock-capture/batches/${openBatch.id}` && method === "GET") {
      return Promise.resolve(json({ batch: openBatch }));
    }
    if (path === "/stock-capture/sessions" && method === "POST") {
      return Promise.resolve(json({ session: exactMatchSessionSummary, exactItemId: item.id }));
    }
    if (path === `/stock-capture/sessions/${exactMatchSessionSummary.id}` && method === "GET") {
      return Promise.resolve(json({ session: exactMatchSessionView }));
    }
    if (path === `/stock-capture/batches/${openBatch.id}/entries` && method === "POST") {
      return Promise.resolve(json(commitResult));
    }

    return Promise.resolve(
      json({ detail: `No fake for ${method} ${path}`, code: "test.missing" }, 404),
    );
  });
}

function renderPage(api: ApiClient): void {
  render(
    <ApiProvider client={api}>
      <MemoryRouter>
        <StockCapturePage barcodeProvider={noBarcodes} />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe("StockCapturePage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("starts a fresh batch when nothing was in progress", async () => {
    const requests: string[] = [];
    renderPage(createStockCaptureApi((method, path) => requests.push(`${method} ${path}`)));

    await waitFor(() => {
      expect(screen.getByText(/nothing has been added to stock yet/iu)).toBeInTheDocument();
    });
    expect(requests).toContain("POST /stock-capture/batches");
  });

  it("resumes a batch left in session storage instead of starting a new one", async () => {
    saveCaptureProgress({ batchId: openBatch.id, sessionId: null });
    const requests: string[] = [];
    renderPage(createStockCaptureApi((method, path) => requests.push(`${method} ${path}`)));

    await waitFor(() => {
      expect(screen.getByText(/nothing has been added to stock yet/iu)).toBeInTheDocument();
    });
    expect(requests).not.toContain("POST /stock-capture/batches");
    expect(requests).toContain(`GET /stock-capture/batches/${openBatch.id}`);
  });

  it("captures a photo, resolves an exact barcode match and commits a receipt", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ApiProvider client={createStockCaptureApi()}>
        <MemoryRouter>
          <StockCapturePage barcodeProvider={noBarcodes} />
        </MemoryRouter>
      </ApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add another item/iu })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /add another item/iu }));

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const photo = new File(["fake"], "widget.jpg", { type: "image/jpeg" });
    await user.upload(fileInput as HTMLInputElement, photo);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue/iu })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /continue/iu }));

    await waitFor(
      () => {
        expect(screen.getByText(item.name)).toBeInTheDocument();
      },
      { timeout: 3_000 },
    );

    await user.click(screen.getByText(item.name));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Quantity/u)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/^Quantity/u), "5");
    await user.click(screen.getByRole("button", { name: /confirm receipt/iu }));

    await waitFor(() => {
      expect(screen.getByText("Stock received.")).toBeInTheDocument();
    });
  });
});

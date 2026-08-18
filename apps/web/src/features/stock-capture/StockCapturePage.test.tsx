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
import { AuthProvider } from "../../auth/AuthContext";
import { createStubAuthClient } from "../../test/auth";
import type { BarcodeProvider } from "../scan/barcode/provider";
import { loadCaptureProgress, saveCaptureProgress } from "./capture-storage";
import { discardOfferedPhotos } from "./handoff";
import { StockCapturePage, type CaptureImagePipeline } from "./StockCapturePage";

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

const captureSessionSummary: RecognitionSessionSummaryView = {
  id: "session-1",
  status: "AwaitingUpload",
  photoCount: 1,
  createdAt: "2026-08-10T09:05:00.000Z",
  expiresAt: "2026-08-10T15:05:00.000Z",
  committedItemId: null,
  failureCode: null,
};

const exactMatchSessionView: RecognitionSessionView = {
  ...captureSessionSummary,
  status: "ReviewReady",
  batchId: openBatch.id,
  photos: [
    {
      id: "image-1",
      ordinal: 1,
      url: "/api/v1/stock-capture/sessions/session-1/images/image-1",
      mediaType: "image/jpeg",
    },
  ],
  detectedBarcodes: [{ value: item.barcode ?? "", symbology: "EAN_13", imageOrdinal: 1 }],
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
  suggestedDraft: null,
  stageReports: [],
  recommendManualEntry: false,
};

const commitResult: CommitCaptureEntryResponse = {
  item,
  transactionId: "txn-1",
  createdItem: false,
  batch: { ...openBatch, committedEntryCount: 1 },
};

const testImagePipeline: CaptureImagePipeline = {
  normalise: (source) =>
    Promise.resolve({
      file: source,
      mediaType: "image/jpeg",
      byteLength: source.size,
      width: 800,
      height: 600,
      sha256: "a".repeat(64),
    }),
  upload: () => Promise.resolve(),
};

/**
 * Every server response this journey needs, canned by exact path. No
 * candidate-fusion machinery is exercised here; the photograph still follows
 * the complete upload and recognition journey even when its barcode matches.
 */
interface StockCaptureApiOptions {
  /** Sees each commit body and decides whether that attempt succeeds, so a
   *  test can make the first one fail the way a dropped response does. */
  readonly onEntry?: (body: string) => "fail" | "succeed";
}

function createStockCaptureApi(
  onRequest?: (method: string, path: string) => void,
  options: StockCaptureApiOptions = {},
): ApiClient {
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
    if (path === "/stock-capture/batches/open" && method === "GET") {
      return Promise.resolve(json({ batch: null }));
    }
    if (path === `/stock-capture/batches/${openBatch.id}` && method === "GET") {
      return Promise.resolve(json({ batch: openBatch }));
    }
    if (path === "/stock-capture/sessions" && method === "POST") {
      return Promise.resolve(json({ session: captureSessionSummary, exactItemId: null }));
    }
    if (
      path === `/stock-capture/sessions/${captureSessionSummary.id}/uploads` &&
      method === "POST"
    ) {
      return Promise.resolve(
        json({
          session: captureSessionSummary,
          grants: [
            {
              imageId: "image-1",
              ordinal: 1,
              url: `/api/v1/stock-capture/sessions/${captureSessionSummary.id}/uploads/image-1`,
              mediaType: "image/jpeg",
              expiresAt: captureSessionSummary.expiresAt,
            },
          ],
        }),
      );
    }
    if (
      path === `/stock-capture/sessions/${captureSessionSummary.id}/uploads/complete` &&
      method === "POST"
    ) {
      return Promise.resolve(json({ session: { ...captureSessionSummary, status: "Queued" } }));
    }
    if (path === `/stock-capture/sessions/${captureSessionSummary.id}` && method === "GET") {
      return Promise.resolve(json({ session: exactMatchSessionView }));
    }
    if (path === `/stock-capture/batches/${openBatch.id}/entries` && method === "POST") {
      const body = typeof init?.body === "string" ? init.body : "";
      const outcome = options.onEntry?.(body) ?? "succeed";
      return Promise.resolve(
        outcome === "succeed"
          ? json(commitResult)
          : json({ detail: "That could not be saved just now.", code: "test.transient" }, 503),
      );
    }
    if (path === `/stock-capture/batches/${openBatch.id}/complete` && method === "POST") {
      return Promise.resolve(
        json({ batch: { ...openBatch, status: "Completed", committedEntryCount: 0 } }),
      );
    }

    return Promise.resolve(
      json({ detail: `No fake for ${method} ${path}`, code: "test.missing" }, 404),
    );
  });
}

function renderPage(api: ApiClient): void {
  render(
    <ApiProvider client={api}>
      <AuthProvider client={createStubAuthClient()}>
        <MemoryRouter>
          <StockCapturePage barcodeProvider={noBarcodes} imagePipeline={testImagePipeline} />
        </MemoryRouter>
      </AuthProvider>
    </ApiProvider>,
  );
}

/**
 * Photographing an item now begins in the scan sheet, which is where the
 * decision to send anything is taken. One photograph, opted in to, is the
 * shortest complete version of that.
 */
async function photographAndSend(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /photograph an item/iu })).toBeEnabled();
  });
  await user.click(screen.getByRole("button", { name: /photograph an item/iu }));

  /* The sheet is a dialog, so it renders in a portal rather than inside the
   * page's own container. Its library input is the way in without a camera. */
  const fileInput = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    expect(found).not.toBeNull();
    return found;
  });
  await user.upload(
    fileInput as HTMLInputElement,
    new File(["fake"], "widget.jpg", { type: "image/jpeg" }),
  );

  await user.click(await screen.findByRole("button", { name: /add this as a new item/iu }));
}

describe("StockCapturePage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    discardOfferedPhotos();
  });

  it("starts a fresh batch when nothing was in progress", async () => {
    const requests: string[] = [];
    renderPage(createStockCaptureApi((method, path) => requests.push(`${method} ${path}`)));

    await waitFor(() => {
      expect(screen.getByText(/nothing is waiting/iu)).toBeInTheDocument();
    });
    expect(requests).toContain("POST /stock-capture/batches");
  });

  it("resumes a batch left in local storage instead of starting a new one", async () => {
    saveCaptureProgress({ batchId: openBatch.id, sessionId: null });
    const requests: string[] = [];
    renderPage(createStockCaptureApi((method, path) => requests.push(`${method} ${path}`)));

    await waitFor(() => {
      expect(screen.getByText(/nothing is waiting/iu)).toBeInTheDocument();
    });
    expect(requests).not.toContain("POST /stock-capture/batches");
    expect(requests).toContain(`GET /stock-capture/batches/${openBatch.id}`);
  });

  it("runs a barcode match through the full photo pipeline and commits a receipt", async () => {
    const user = userEvent.setup();
    renderPage(createStockCaptureApi());

    await photographAndSend(user);

    await waitFor(
      () => {
        expect(screen.getByText(item.name)).toBeInTheDocument();
      },
      { timeout: 3_000 },
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Quantity/u)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/^Quantity/u), "5");
    await user.click(screen.getByRole("button", { name: /confirm receipt/iu }));

    await waitFor(() => {
      expect(screen.getByText("Stock received.")).toBeInTheDocument();
      expect(screen.getByText(item.reference)).toBeInTheDocument();
    });
  });

  /*
   * The bug this covers: `clientEntryId` used to be minted inside the commit
   * handler, so a retry after a lost or failed response carried a key the
   * server had never seen and was written as a second receipt. One delivery,
   * two stock movements, no way to tell from the screen.
   */
  it("retries a failed confirmation under the same idempotency key", async () => {
    const user = userEvent.setup();
    const entryBodies: string[] = [];
    let commitAttempts = 0;

    const api = createStockCaptureApi(undefined, {
      onEntry: (body) => {
        entryBodies.push(body);
        commitAttempts += 1;
        return commitAttempts === 1 ? "fail" : "succeed";
      },
    });

    renderPage(api);

    await photographAndSend(user);

    await waitFor(() => {
      expect(screen.getByText(item.name)).toBeInTheDocument();
    });
    await user.click(screen.getByText(item.name));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Quantity/u)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/^Quantity/u), "5");

    await user.click(screen.getByRole("button", { name: /confirm receipt/iu }));
    await waitFor(() => {
      expect(screen.getByText("That could not be saved just now.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /confirm receipt/iu }));
    await waitFor(() => {
      expect(screen.getByText("Stock received.")).toBeInTheDocument();
    });

    expect(entryBodies).toHaveLength(2);
    const keys = entryBodies.map(
      (body) => (JSON.parse(body) as { clientEntryId: string }).clientEntryId,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  /*
   * Finishing used to leave a dead-end screen whose only way forward was a
   * button called "Start another batch" — a step that existed because the code
   * needed it, not because anybody had a decision to make. The next delivery
   * is now open by the time the confirmation is read.
   */
  it("opens the next delivery as soon as one is finished", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    renderPage(createStockCaptureApi((method, path) => requests.push(`${method} ${path}`)));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /finish this delivery/iu })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /finish this delivery/iu }));

    await waitFor(() => {
      expect(screen.getByText(/that delivery is finished/iu)).toBeInTheDocument();
    });
    expect(screen.getByText(/nothing is waiting/iu)).toBeInTheDocument();
    expect(requests).toContain(`POST /stock-capture/batches/${openBatch.id}/complete`);
    expect(requests.filter((entry) => entry === "POST /stock-capture/batches")).toHaveLength(2);
  });

  /*
   * Clearing the stored batch id here meant a refresh immediately after
   * adding an item abandoned the batch that item had gone into.
   */
  it("keeps the batch recoverable after a receipt is confirmed", async () => {
    const user = userEvent.setup();
    renderPage(createStockCaptureApi());

    await photographAndSend(user);
    await waitFor(() => {
      expect(screen.getByText(item.name)).toBeInTheDocument();
    });
    await user.click(screen.getByText(item.name));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Quantity/u)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/^Quantity/u), "5");
    await user.click(screen.getByRole("button", { name: /confirm receipt/iu }));

    await waitFor(() => {
      expect(screen.getByText("Stock received.")).toBeInTheDocument();
    });
    expect(loadCaptureProgress()).toEqual({ batchId: openBatch.id, sessionId: null });
  });
});

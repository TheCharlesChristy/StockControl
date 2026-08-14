import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CaptureUploadGrant,
  LocationListResponse,
  RecognitionSessionSummaryView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiClient } from "../../api/ApiClient";
import { ApiProvider } from "../../api/ApiContext";
import type { BarcodeProvider } from "./barcode/provider";
import { clearCaptureProgress } from "./capture-storage";
import { StockCapturePage, type CaptureImagePipeline } from "./StockCapturePage";
import type { NormalisedImage } from "./upload/normalise";

/*
 * The photograph upload leg, which shipped with no coverage at all: the one
 * photo test in StockCapturePage.test.tsx takes the exact-barcode short cut,
 * and that path returns a session already past `AwaitingUpload`, so it never
 * normalises, never asks for a grant and never PUTs anything. Two bugs lived
 * in the gap — see the individual tests.
 */

const noBarcodes: BarcodeProvider = {
  readerVersion: "test-decoder",
  decode: () => Promise.resolve([]),
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

const awaitingUpload: RecognitionSessionSummaryView = {
  id: "session-upload",
  status: "AwaitingUpload",
  photoCount: 2,
  createdAt: "2026-08-10T09:05:00.000Z",
  expiresAt: "2026-08-10T15:05:00.000Z",
  committedItemId: null,
  failureCode: null,
};

const queued: RecognitionSessionSummaryView = { ...awaitingUpload, status: "Queued" };

const normalisedFor = (): NormalisedImage => ({
  file: new File(["normalised"], "capture.jpg", { type: "image/jpeg" }),
  mediaType: "image/jpeg",
  byteLength: 10,
  width: 800,
  height: 600,
  sha256: "a".repeat(64),
});

/*
 * Yielding to the macrotask queue is the whole point rather than an
 * incidental detail: a PUT that resolves in the same microtask chain lets the
 * upload loop run to completion before React ever processes the state update
 * it dispatched, which hides exactly the re-entrancy these tests exist to
 * catch. A real upload takes long enough for React to re-render several times.
 */
const yieldToRender = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Stands in for the canvas pipeline, which does not exist in jsdom, and
 * records every grant it is asked to PUT so a test can count them.
 */
const recordingPipeline = (): {
  pipeline: CaptureImagePipeline;
  uploaded: CaptureUploadGrant[];
} => {
  const uploaded: CaptureUploadGrant[] = [];

  return {
    uploaded,
    pipeline: {
      normalise: async () => {
        await yieldToRender();
        return normalisedFor();
      },
      upload: async (grant) => {
        await yieldToRender();
        uploaded.push(grant);
      },
    },
  };
};

interface UploadApiOptions {
  /** Models the real insert, which does nothing when a row for that ordinal
   *  already exists — so a second request must hand back the first ids. */
  readonly stableGrants?: boolean;
}

function createUploadApi(
  onRequest: (method: string, path: string) => void,
  options: UploadApiOptions = {},
): ApiClient {
  const json = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  let grantRound = 0;

  return new ApiClient((input, init) => {
    const url = typeof input === "string" ? input : String((input as URL).href);
    const path = url.replace("/api/v1", "").split("?")[0] ?? "";
    const method = init?.method ?? "GET";
    onRequest(method, path);

    if (path === "/locations" && method === "GET") return Promise.resolve(json(locations));
    if (path === "/stock-capture/batches" && method === "POST") {
      return Promise.resolve(json({ batch: openBatch }));
    }
    if (path === "/stock-capture/sessions" && method === "POST") {
      return Promise.resolve(json({ session: awaitingUpload, exactItemId: null }));
    }
    if (path === `/stock-capture/sessions/${awaitingUpload.id}/uploads` && method === "POST") {
      /* Fresh ids per round unless the caller asks for the fixed server. */
      grantRound += options.stableGrants === true ? 0 : 1;
      const suffix = String(grantRound);
      return Promise.resolve(
        json({
          session: awaitingUpload,
          grants: [1, 2].map((ordinal) => ({
            imageId: `image-${String(ordinal)}-${suffix}`,
            ordinal,
            url: `/api/v1/stock-capture/sessions/${awaitingUpload.id}/uploads/image-${String(ordinal)}-${suffix}`,
            mediaType: "image/jpeg" as const,
            expiresAt: awaitingUpload.expiresAt,
          })),
        }),
      );
    }
    if (
      path === `/stock-capture/sessions/${awaitingUpload.id}/uploads/complete` &&
      method === "POST"
    ) {
      return Promise.resolve(json({ session: queued }));
    }
    if (path === `/stock-capture/sessions/${awaitingUpload.id}` && method === "GET") {
      return Promise.resolve(
        json({
          session: {
            ...queued,
            batchId: openBatch.id,
            candidates: [],
            stageReports: [],
            recommendManualEntry: false,
            analysisOutcome: "Completed" as const,
          },
        }),
      );
    }

    return Promise.resolve(
      json({ detail: `No fake for ${method} ${path}`, code: "test.missing" }, 404),
    );
  });
}

const addPhotos = async (
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  count: number,
): Promise<void> => {
  const input = container.querySelector('input[type="file"]');
  expect(input).not.toBeNull();

  for (let index = 0; index < count; index += 1) {
    await user.upload(
      input as HTMLInputElement,
      new File(["photo"], `photo-${String(index)}.jpg`, { type: "image/jpeg" }),
    );
  }
};

describe("the capture upload journey", () => {
  beforeEach(() => {
    clearCaptureProgress();
  });

  afterEach(() => {
    clearCaptureProgress();
  });

  /*
   * The bug: the upload effect listed `stage` in its dependencies while
   * dispatching `UploadProgressed` into that same stage, so every finished
   * photograph tore the effect down and started it over. The restart asked
   * for a second set of grants, and because the server's insert does nothing
   * for an ordinal it already holds, those ids named rows that were never
   * written — so every PUT after the first was refused. One request for
   * grants, per session, is the whole invariant.
   */
  it("asks for upload grants once, however many photographs there are", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const { pipeline, uploaded } = recordingPipeline();

    const { container } = render(
      <ApiProvider client={createUploadApi((method, path) => requests.push(`${method} ${path}`))}>
        <MemoryRouter>
          <StockCapturePage barcodeProvider={noBarcodes} imagePipeline={pipeline} />
        </MemoryRouter>
      </ApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /photograph an item/iu })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /photograph an item/iu }));
    await addPhotos(user, container, 2);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue/iu })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /continue/iu }));

    await waitFor(
      () => {
        expect(
          requests.filter(
            (entry) =>
              entry === `POST /stock-capture/sessions/${awaitingUpload.id}/uploads/complete`,
          ),
        ).toHaveLength(1);
      },
      { timeout: 3_000 },
    );

    expect(
      requests.filter(
        (entry) => entry === `POST /stock-capture/sessions/${awaitingUpload.id}/uploads`,
      ),
    ).toHaveLength(1);
    expect(uploaded.map((grant) => grant.ordinal)).toEqual([1, 2]);
  });

  it("sends every photograph exactly once", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const { pipeline, uploaded } = recordingPipeline();

    const { container } = render(
      <ApiProvider
        client={createUploadApi((method, path) => requests.push(`${method} ${path}`), {
          stableGrants: true,
        })}
      >
        <MemoryRouter>
          <StockCapturePage barcodeProvider={noBarcodes} imagePipeline={pipeline} />
        </MemoryRouter>
      </ApiProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /photograph an item/iu })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /photograph an item/iu }));
    await addPhotos(user, container, 2);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue/iu })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /continue/iu }));

    await waitFor(
      () => {
        expect(
          requests.filter(
            (entry) =>
              entry === `POST /stock-capture/sessions/${awaitingUpload.id}/uploads/complete`,
          ),
        ).toHaveLength(1);
      },
      { timeout: 3_000 },
    );

    /* Settle, so a duplicate send in flight has every chance to land. */
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(uploaded).toHaveLength(2);
    expect(new Set(uploaded.map((grant) => grant.imageId)).size).toBe(2);
  });
});

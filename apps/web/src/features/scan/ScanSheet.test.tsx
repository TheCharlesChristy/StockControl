import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionFeatures, UserRole } from "@stockcontrol/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../../api/ApiClient";
import { ApiProvider } from "../../api/ApiContext";
import { AuthProvider } from "../../auth/AuthContext";
import { createFakeApiClient, testItemDetail, type RecordedRequest } from "../../test/fake-api";
import { createStubAuthClient } from "../../test/auth";
import type { BarcodeProvider } from "./barcode/provider";
import type { CapturedPhoto } from "./photo-tray";
import { ScanSheet } from "./ScanSheet";

const zxing = vi.hoisted(() => ({
  decodeFromConstraints: vi.fn(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    public decodeFromConstraints = zxing.decodeFromConstraints;
  },
}));

const decodesNothing: BarcodeProvider = {
  readerVersion: "test-decoder",
  decode: () => Promise.resolve([]),
};

const decodes = (value: string): BarcodeProvider => ({
  readerVersion: "test-decoder",
  decode: () => Promise.resolve([{ value, symbology: "EAN-13" }]),
});

interface RenderOptions {
  readonly role?: UserRole;
  readonly features?: SessionFeatures;
  readonly barcodeProvider?: BarcodeProvider;
  readonly onIdentifyPhotos?: (photos: readonly CapturedPhoto[]) => void;
  readonly api?: ApiClient;
}

function renderSheet({
  role = "Office",
  features = { stockCapture: true },
  barcodeProvider = decodesNothing,
  onIdentifyPhotos,
  api = createFakeApiClient(),
}: RenderOptions = {}): void {
  render(
    <ApiProvider client={api}>
      <AuthProvider client={createStubAuthClient({ role, features })}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route
              path="/dashboard"
              element={
                <ScanSheet
                  open
                  onClose={vi.fn()}
                  barcodeProvider={barcodeProvider}
                  {...(onIdentifyPhotos === undefined ? {} : { onIdentifyPhotos })}
                />
              }
            />
            <Route path="/inventory/:itemId" element={<p>The item page</p>} />
            <Route path="/stock-capture" element={<p>The delivery queue</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ApiProvider>,
  );
}

const attachPhoto = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    expect(found).not.toBeNull();
    return found;
  });

  await user.upload(
    input as HTMLInputElement,
    new File(["photo"], "item.jpg", { type: "image/jpeg" }),
  );
};

describe("the scan sheet's camera", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("attaches the camera to the rendered preview and supports laptop webcams", async () => {
    zxing.decodeFromConstraints.mockResolvedValue({ stop: vi.fn() });

    renderSheet();

    await waitFor(() => expect(zxing.decodeFromConstraints).toHaveBeenCalledOnce());

    const [constraints, preview] = zxing.decodeFromConstraints.mock.calls[0] as [
      MediaStreamConstraints,
      HTMLVideoElement,
    ];

    expect(preview).toBe(screen.getByLabelText("Camera preview"));
    expect(constraints).toEqual({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  });
});

/*
 * The whole point of the merge: a photograph is read here, on the device, and
 * only an explicit choice sends it anywhere. These tests exist so that
 * "explicit" cannot quietly become "on attaching a photograph".
 */
describe("sending photographs to be identified", () => {
  afterEach(() => {
    /* Restores as well as clears: one of these tests spies on the object-URL
     * lifetime, which every later test relies on being real. */
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("sends nothing when a photograph is attached, and offers the choice instead", async () => {
    const user = userEvent.setup();
    const requests: RecordedRequest[] = [];
    const onIdentifyPhotos = vi.fn();

    renderSheet({
      onIdentifyPhotos,
      api: createFakeApiClient({}, (request) => requests.push(request)),
    });

    await attachPhoto(user);

    const send = await screen.findByRole("button", { name: /to be identified/iu });
    expect(onIdentifyPhotos).not.toHaveBeenCalled();
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);

    await user.click(send);

    expect(onIdentifyPhotos).toHaveBeenCalledTimes(1);
    expect(onIdentifyPhotos.mock.calls[0]?.[0]).toHaveLength(1);
  });

  /*
   * The capture page shows these same photographs while it uploads them, from
   * the very object URLs created here. Revoking them on the way out — which the
   * sheet does for photographs nobody sent — blanked its thumbnails mid-upload.
   */
  it("leaves the previews alone once the photographs belong to the delivery", async () => {
    const user = userEvent.setup();
    const created: string[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:photo-${String(created.length)}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });

    renderSheet({ onIdentifyPhotos: vi.fn() });
    await attachPhoto(user);
    await user.click(await screen.findByRole("button", { name: /to be identified/iu }));

    expect(created).toHaveLength(1);
    expect(revoked).not.toContain(created[0]);
  });

  it("says what will be sent before it is sent", async () => {
    const user = userEvent.setup();
    renderSheet({ onIdentifyPhotos: vi.fn() });

    await attachPhoto(user);

    expect(await screen.findByText(/nothing has left this device/iu)).toBeInTheDocument();
    expect(screen.getByText(/sends the photo to StockControl to be identified/iu)).toBeVisible();
  });

  /*
   * The server refuses assisted capture to anyone without `manageStock`, so
   * offering it to an Engineer would be a button that only ever fails.
   */
  it("never offers it to a role the server would refuse", async () => {
    const user = userEvent.setup();
    renderSheet({ role: "Engineer" });

    await attachPhoto(user);

    expect(await screen.findByText(/no code was found in those photos/iu)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to be identified/iu })).not.toBeInTheDocument();
  });

  it("never offers it where the installation has the feature switched off", async () => {
    const user = userEvent.setup();
    renderSheet({ role: "Admin", features: { stockCapture: false } });

    await attachPhoto(user);

    expect(await screen.findByText(/no code was found in those photos/iu)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to be identified/iu })).not.toBeInTheDocument();
  });

  /*
   * Recognition is the fallback, not the route. A code read on the device
   * answers the question for nothing, so it must never be talked past.
   */
  it("does not offer it when the photograph identified the item on its own", async () => {
    const user = userEvent.setup();
    renderSheet({ barcodeProvider: decodes(testItemDetail.barcode ?? "") });

    await attachPhoto(user);

    expect(await screen.findByText(testItemDetail.name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to be identified/iu })).not.toBeInTheDocument();
  });
});

describe("what a scanned item leads to", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("offers stock and the record to somebody who can move stock", async () => {
    const user = userEvent.setup();
    renderSheet({ role: "Office" });

    await user.type(screen.getByLabelText(/item code or barcode/iu), "ITM-0001");
    await user.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText(testItemDetail.name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add stock/iu })).toBeEnabled();
    expect(screen.getByRole("button", { name: /open item/iu })).toBeEnabled();
  });

  /*
   * An Engineer has one thing they can do with a scanned label, so a card
   * asking them to choose it would be a tap that decides nothing.
   */
  it("takes somebody who can only look straight to the item", async () => {
    const user = userEvent.setup();
    renderSheet({ role: "Engineer" });

    await user.type(screen.getByLabelText(/item code or barcode/iu), "ITM-0001");
    await user.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText("The item page")).toBeInTheDocument();
  });
});

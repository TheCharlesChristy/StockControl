import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionFeatures, UserRole } from "@stockcontrol/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient } from "../../api/ApiClient";
import { ApiProvider } from "../../api/ApiContext";
import { AuthProvider } from "../../auth/AuthContext";
import { createFakeApiClient, testItemDetail, type RecordedRequest } from "../../test/fake-api";
import { createStubAuthClient } from "../../test/auth";
import type { BarcodeProvider } from "./barcode/provider";
import type { FrameGrabber } from "./frame-grabber";
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

/** Stands in for the canvas, which jsdom does not have. */
const shutterTakes = (): FrameGrabber => ({
  grab: () => Promise.resolve(new File(["frame"], "scan.jpg", { type: "image/jpeg" })),
});

/** A catalogue that knows nothing, so a decoded code reaches the dead end. */
const apiMatchingNothing = (): ApiClient =>
  new ApiClient(() =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: "Not found", code: "item.not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

interface RenderOptions {
  readonly role?: UserRole;
  readonly features?: SessionFeatures;
  readonly barcodeProvider?: BarcodeProvider;
  readonly frameGrabber?: FrameGrabber;
  readonly onIdentifyPhotos?: (photos: readonly CapturedPhoto[]) => void;
  readonly api?: ApiClient;
}

function renderSheet({
  role = "Office",
  features = { stockCapture: true },
  barcodeProvider = decodesNothing,
  frameGrabber = shutterTakes(),
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
                  frameGrabber={frameGrabber}
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

/** The camera has to report itself working before the shutter arms. */
const cameraReady = async (): Promise<void> => {
  zxing.decodeFromConstraints.mockResolvedValue({ stop: vi.fn() });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /take a photo/iu })).toBeEnabled();
  });
};

const pressShutter = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await cameraReady();
  await user.click(screen.getByRole("button", { name: /take a photo/iu }));
};

describe("the scan sheet opens a camera", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("attaches the camera to the preview and supports laptop webcams", async () => {
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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  });

  /*
   * A handheld scanner types like a keyboard, and the machines they are
   * plugged into are the ones least likely to have a camera. Hiding the code
   * box behind an icon there would leave that hardware with no way in.
   */
  it("offers the code box straight away when there is no camera", async () => {
    zxing.decodeFromConstraints.mockRejectedValue(new Error("no camera"));

    renderSheet();

    expect(await screen.findByLabelText(/item code or barcode/iu)).toBeInTheDocument();
    expect(screen.getByText(/no camera here/iu)).toBeInTheDocument();
  });
});

describe("what a photo leads to", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /* The whole point of pressing the shutter: a code comes off the photo, the
   * catalogue knows it, and the person is looking at the item. */
  it("goes to the item when the photo carries a code the catalogue knows", async () => {
    const user = userEvent.setup();
    renderSheet({ barcodeProvider: decodes(testItemDetail.barcode ?? "") });

    await pressShutter(user);

    expect(await screen.findByText("The item page")).toBeInTheDocument();
  });

  it("says so when the photo held no code at all", async () => {
    const user = userEvent.setup();
    renderSheet();

    await pressShutter(user);

    expect(await screen.findByText(/not recognised/iu)).toBeInTheDocument();
    expect(screen.getByText(/no barcode or QR code was found/iu)).toBeInTheDocument();
  });

  it("names a code the catalogue does not use", async () => {
    const user = userEvent.setup();
    renderSheet({
      barcodeProvider: decodes("NOT-IN-THE-CATALOGUE"),
      api: apiMatchingNothing(),
    });

    await pressShutter(user);

    expect(await screen.findByText(/NOT-IN-THE-CATALOGUE/u)).toBeInTheDocument();
  });
});

/*
 * The offer to add a new item is also the opt-in: photos are read on the
 * device, and saying yes is the only thing that sends one. These tests exist
 * so that "yes" cannot quietly become "on taking a photo".
 */
describe("offering to add it as a new item", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("sends nothing until the offer is accepted", async () => {
    const user = userEvent.setup();
    const requests: RecordedRequest[] = [];
    const onIdentifyPhotos = vi.fn();

    renderSheet({
      onIdentifyPhotos,
      api: createFakeApiClient({}, (request) => requests.push(request)),
    });

    await pressShutter(user);

    const add = await screen.findByRole("button", { name: /add this as a new item/iu });
    expect(onIdentifyPhotos).not.toHaveBeenCalled();
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);

    await user.click(add);

    expect(onIdentifyPhotos).toHaveBeenCalledTimes(1);
    expect(onIdentifyPhotos.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("says what accepting will send", async () => {
    const user = userEvent.setup();
    renderSheet({ onIdentifyPhotos: vi.fn() });

    await pressShutter(user);

    expect(await screen.findByText(/nothing has left this device/iu)).toBeInTheDocument();
  });

  /*
   * The server refuses assisted capture to anyone without `manageStock`, so
   * offering it to an Engineer would be a button that only ever fails.
   */
  it("never offers it to a role the server would refuse", async () => {
    const user = userEvent.setup();
    renderSheet({ role: "Engineer" });

    await pressShutter(user);

    expect(await screen.findByText(/not recognised/iu)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add this as a new item/iu }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/iu })).toBeEnabled();
  });

  it("never offers it where the installation has the feature switched off", async () => {
    const user = userEvent.setup();
    renderSheet({ role: "Admin", features: { stockCapture: false } });

    await pressShutter(user);

    expect(await screen.findByText(/not recognised/iu)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add this as a new item/iu }),
    ).not.toBeInTheDocument();
  });

  /* Extra angles are the one thing that reliably improves a recognition
   * result, so the moment to offer them is before the photos are sent. */
  it("takes another angle without losing the first shot", async () => {
    const user = userEvent.setup();
    const onIdentifyPhotos = vi.fn();
    renderSheet({ onIdentifyPhotos });

    await pressShutter(user);
    await user.click(await screen.findByRole("button", { name: /another angle/iu }));
    await user.click(screen.getByRole("button", { name: /take a photo/iu }));

    await user.click(await screen.findByRole("button", { name: /add this as a new item/iu }));

    expect(onIdentifyPhotos.mock.calls[0]?.[0]).toHaveLength(2);
  });

  /*
   * The capture page shows these same photos while it uploads them, from the
   * very object URLs created here. Revoking them on the way out — which the
   * sheet does for photos nobody sent — blanked its thumbnails mid-upload.
   */
  it("leaves the previews alone once the photos belong to the delivery", async () => {
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

    await pressShutter(user);
    await user.click(await screen.findByRole("button", { name: /add this as a new item/iu }));

    expect(created).toHaveLength(1);
    expect(revoked).not.toContain(created[0]);
  });
});

describe("typing a code", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("goes to the item a typed code names", async () => {
    const user = userEvent.setup();
    zxing.decodeFromConstraints.mockRejectedValue(new Error("no camera"));
    renderSheet();

    await user.type(await screen.findByLabelText(/item code or barcode/iu), "ITM-0001");
    await user.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText("The item page")).toBeInTheDocument();
  });
});

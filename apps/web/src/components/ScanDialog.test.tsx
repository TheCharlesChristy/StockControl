import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "../api/ApiContext";
import { createFakeApiClient } from "../test/fake-api";
import { ScanDialog } from "./ScanDialog";

const zxing = vi.hoisted(() => ({
  decodeFromConstraints: vi.fn(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    public decodeFromConstraints = zxing.decodeFromConstraints;
  },
}));

describe("ScanDialog camera startup", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("attaches the camera to the rendered preview and supports laptop webcams", async () => {
    zxing.decodeFromConstraints.mockResolvedValue({ stop: vi.fn() });

    render(
      <ApiProvider client={createFakeApiClient()}>
        <MemoryRouter>
          <ScanDialog open onClose={vi.fn()} />
        </MemoryRouter>
      </ApiProvider>,
    );

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

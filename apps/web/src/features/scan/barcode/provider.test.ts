import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBarcodeProvider,
  nativeSymbology,
  NativeBarcodeProvider,
  ZxingBarcodeProvider,
} from "./provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nativeSymbology", () => {
  it("upper-cases and hyphenates a BarcodeDetector format name", () => {
    expect(nativeSymbology("ean_13")).toBe("EAN-13");
    expect(nativeSymbology("qr_code")).toBe("QR-CODE");
  });
});

describe("NativeBarcodeProvider", () => {
  it("maps every detected result and releases the decoded bitmap", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 100, height: 100, close }),
    );

    const detect = vi.fn().mockResolvedValue([{ rawValue: "5012345678900", format: "ean_13" }]);
    const provider = new NativeBarcodeProvider({ detect });

    const results = await provider.decode(new Blob(["fake"]));

    expect(results).toEqual([{ value: "5012345678900", symbology: "EAN-13" }]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns an empty list when nothing is detected", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }),
    );
    const provider = new NativeBarcodeProvider({ detect: vi.fn().mockResolvedValue([]) });

    await expect(provider.decode(new Blob(["fake"]))).resolves.toEqual([]);
  });

  it("releases the bitmap even when detection throws", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 100, height: 100, close }),
    );
    const provider = new NativeBarcodeProvider({
      detect: vi.fn().mockRejectedValue(new Error("detector failed")),
    });

    await expect(provider.decode(new Blob(["fake"]))).rejects.toThrow("detector failed");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("ZxingBarcodeProvider", () => {
  it("decodes a still image and reports the format as its symbology", async () => {
    class LoadingImage extends EventTarget {
      public set src(value: string) {
        void value;
        queueMicrotask(() => {
          this.dispatchEvent(new Event("load"));
        });
      }
    }
    vi.stubGlobal("Image", LoadingImage);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });

    const decodeFromImageElement = vi.fn().mockResolvedValue({
      getText: () => "ITM-0001",
      getBarcodeFormat: () => "QR_CODE",
    });
    const provider = new ZxingBarcodeProvider({ decodeFromImageElement });

    const results = await provider.decode(new Blob(["fake"]));

    expect(results).toEqual([{ value: "ITM-0001", symbology: "QR_CODE" }]);
    expect(decodeFromImageElement).toHaveBeenCalledOnce();
  });

  it("returns an empty list rather than throwing when no code is found", async () => {
    class LoadingImage extends EventTarget {
      public set src(value: string) {
        void value;
        queueMicrotask(() => {
          this.dispatchEvent(new Event("load"));
        });
      }
    }
    vi.stubGlobal("Image", LoadingImage);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });

    const provider = new ZxingBarcodeProvider({
      decodeFromImageElement: vi.fn().mockRejectedValue(new Error("NotFoundException")),
    });

    await expect(provider.decode(new Blob(["fake"]))).resolves.toEqual([]);
  });

  it("rejects when the photograph itself cannot be loaded", async () => {
    class FailingImage extends EventTarget {
      public set src(value: string) {
        void value;
        queueMicrotask(() => {
          this.dispatchEvent(new Event("error"));
        });
      }
    }
    vi.stubGlobal("Image", FailingImage);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });

    const provider = new ZxingBarcodeProvider({ decodeFromImageElement: vi.fn() });

    await expect(provider.decode(new Blob(["fake"]))).resolves.toEqual([]);
  });
});

describe("createBarcodeProvider", () => {
  it("prefers the native BarcodeDetector when the browser exposes one", () => {
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        public detect(): Promise<never[]> {
          return Promise.resolve([]);
        }
      },
    );

    expect(createBarcodeProvider().readerVersion).toContain("native");
  });

  it("falls back to the ZXing decoder otherwise", () => {
    vi.stubGlobal("BarcodeDetector", undefined);

    expect(createBarcodeProvider().readerVersion).toContain("zxing");
  });
});

import { BrowserMultiFormatReader } from "@zxing/browser";

/*
 * Runs against the original-resolution captured image, before the upload
 * pipeline's own downscaling — a code that survives a 2,048px-long-edge
 * re-encode usually still reads, but there is no reason to make the fast
 * path depend on that.
 *
 * `BarcodeDetector` is the fast path where the browser has it; ZXing's
 * still-image decoder is the universal fallback everywhere else. Genuinely
 * offloading the fallback decode to a Web Worker, as the specification's
 * fuller vision describes, is not done here — this runs on the main thread.
 * A single still-image decode is a bounded, one-shot cost per photograph,
 * not a live per-frame loop, so the trade-off is a slower capture screen on
 * very old hardware, never a hung one.
 */

export interface DecodedBarcode {
  readonly value: string;
  readonly symbology: string;
}

export interface BarcodeProvider {
  /** Identifies which decoder produced a result, carried into
   * `LocalBarcodeObservation.readerVersion` for the server's own audit. */
  readonly readerVersion: string;
  decode(source: Blob): Promise<readonly DecodedBarcode[]>;
}

/** The subset of the proposed `BarcodeDetector` API this module depends on.
 * Not yet in TypeScript's DOM lib, so declared locally. */
interface NativeDetectionResult {
  readonly rawValue: string;
  readonly format: string;
}

interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<readonly NativeDetectionResult[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { readonly formats: readonly string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<readonly string[]>;
}

const NATIVE_FORMATS = [
  "codabar",
  "code_39",
  "code_93",
  "code_128",
  "ean_8",
  "ean_13",
  "itf",
  "qr_code",
  "upc_a",
  "upc_e",
] as const;

export const nativeSymbology = (format: string): string => format.toUpperCase().replace(/_/gu, "-");

export class NativeBarcodeProvider implements BarcodeProvider {
  public readonly readerVersion = "native-barcode-detector-1.0";

  public constructor(private readonly detector: NativeBarcodeDetector) {}

  public async decode(source: Blob): Promise<readonly DecodedBarcode[]> {
    const bitmap = await createImageBitmap(source);
    try {
      const results = await this.detector.detect(bitmap);
      return results.map((result) => ({
        value: result.rawValue,
        symbology: nativeSymbology(result.format),
      }));
    } finally {
      bitmap.close();
    }
  }
}

export interface StillImageReader {
  decodeFromImageElement(source: HTMLImageElement): Promise<{
    getText(): string;
    getBarcodeFormat(): { toString(): string } | number | string;
  }>;
}

export class ZxingBarcodeProvider implements BarcodeProvider {
  public readonly readerVersion = "zxing-browser-0.1.5";

  public constructor(private readonly reader: StillImageReader) {}

  public async decode(source: Blob): Promise<readonly DecodedBarcode[]> {
    const url = URL.createObjectURL(source);
    const image = new Image();

    try {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => {
          resolve();
        });
        image.addEventListener("error", () => {
          reject(new Error("Could not load the photograph for barcode decoding."));
        });
        image.src = url;
      });

      const result = await this.reader.decodeFromImageElement(image);
      return [{ value: result.getText(), symbology: String(result.getBarcodeFormat()) }];
    } catch {
      /* No code found is the ordinary case for most photographs, not a fault. */
      return [];
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const nativeDetectorConstructor = (): NativeBarcodeDetectorConstructor | null => {
  if (typeof window === "undefined") return null;
  const candidate = (window as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof candidate === "function"
    ? (candidate as unknown as NativeBarcodeDetectorConstructor)
    : null;
};

export const createBarcodeProvider = (): BarcodeProvider => {
  const Detector = nativeDetectorConstructor();

  if (Detector !== null) {
    return new NativeBarcodeProvider(new Detector({ formats: NATIVE_FORMATS }));
  }

  return new ZxingBarcodeProvider(new BrowserMultiFormatReader());
};

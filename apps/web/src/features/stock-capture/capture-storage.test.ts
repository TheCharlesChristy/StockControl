import { describe, expect, it } from "vitest";

import { clearCaptureProgress, loadCaptureProgress, saveCaptureProgress } from "./capture-storage";

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();
  public get length(): number {
    return this.values.size;
  }
  public clear(): void {
    this.values.clear();
  }
  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  public key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  public removeItem(key: string): void {
    this.values.delete(key);
  }
  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("capture progress storage", () => {
  it("returns null when nothing has been saved", () => {
    expect(loadCaptureProgress(new FakeStorage())).toBeNull();
  });

  it("round-trips a batch with no session yet", () => {
    const storage = new FakeStorage();
    saveCaptureProgress({ batchId: "batch-1", sessionId: null }, storage);
    expect(loadCaptureProgress(storage)).toEqual({ batchId: "batch-1", sessionId: null });
  });

  it("round-trips a batch and session", () => {
    const storage = new FakeStorage();
    saveCaptureProgress({ batchId: "batch-1", sessionId: "session-1" }, storage);
    expect(loadCaptureProgress(storage)).toEqual({ batchId: "batch-1", sessionId: "session-1" });
  });

  it("clears the saved progress", () => {
    const storage = new FakeStorage();
    saveCaptureProgress({ batchId: "batch-1", sessionId: null }, storage);
    clearCaptureProgress(storage);
    expect(loadCaptureProgress(storage)).toBeNull();
  });

  it.each(["not json", "42", '"a string"', '{"sessionId":"s"}', '{"batchId":5}'])(
    "treats malformed stored content %j as absent",
    (raw) => {
      const storage = new FakeStorage();
      storage.setItem("stockcontrol.capture.progress", raw);
      expect(loadCaptureProgress(storage)).toBeNull();
    },
  );
});

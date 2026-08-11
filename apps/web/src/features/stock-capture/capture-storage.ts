/*
 * The only thing this feature persists in the browser: the batch and session
 * UUIDs, so a reload or an accidental navigation resumes rather than orphans
 * an open batch. Session storage, not local storage — a capture batch is a
 * single visit's work, not something that should still be waiting a week
 * later. Never image bytes, decoded frames, raw OCR, model prompts or
 * presigned URLs: none of that is recoverable from a UUID alone, which is
 * exactly the point.
 */

const STORAGE_KEY = "stockcontrol.capture.progress";

export interface CaptureProgress {
  readonly batchId: string;
  readonly sessionId: string | null;
}

export const loadCaptureProgress = (
  storage: Storage = window.sessionStorage,
): CaptureProgress | null => {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { batchId?: unknown }).batchId !== "string"
    ) {
      return null;
    }
    const sessionId = (parsed as { sessionId?: unknown }).sessionId;
    return {
      batchId: (parsed as { batchId: string }).batchId,
      sessionId: typeof sessionId === "string" ? sessionId : null,
    };
  } catch {
    return null;
  }
};

export const saveCaptureProgress = (
  progress: CaptureProgress,
  storage: Storage = window.sessionStorage,
): void => {
  storage.setItem(STORAGE_KEY, JSON.stringify(progress));
};

export const clearCaptureProgress = (storage: Storage = window.sessionStorage): void => {
  storage.removeItem(STORAGE_KEY);
};

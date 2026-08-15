/*
 * The only thing this feature persists in the browser: the batch and session
 * UUIDs, so a reload, browser restart or accidental navigation resumes rather
 * than orphans an open queue. Never image bytes, decoded frames, raw OCR,
 * model prompts or upload grants: those stay in private server storage.
 */

const STORAGE_KEY = "stockcontrol.capture.progress";

export interface CaptureProgress {
  readonly batchId: string;
  readonly sessionId: string | null;
}

export const loadCaptureProgress = (
  storage: Storage = window.localStorage,
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
  storage: Storage = window.localStorage,
): void => {
  storage.setItem(STORAGE_KEY, JSON.stringify(progress));
};

export const clearCaptureProgress = (storage: Storage = window.localStorage): void => {
  storage.removeItem(STORAGE_KEY);
};

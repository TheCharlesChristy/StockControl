import { useSyncExternalStore } from "react";

export interface ConsoleErrorEntry {
  readonly id: string;
  readonly summary: string;
  readonly detail: string;
  readonly count: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

const MAX_SUMMARY_LENGTH = 200;

let entries: readonly ConsoleErrorEntry[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  entries = [...entries];
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** Also used directly by tests that need to clear the store between cases. */
export function getConsoleErrorEntries(): readonly ConsoleErrorEntry[] {
  return entries;
}

/** Newest-first, so a fresh error does not land below ones already dismissed from view. */
export function useConsoleErrorEntries(): readonly ConsoleErrorEntry[] {
  return useSyncExternalStore(subscribe, getConsoleErrorEntries, getConsoleErrorEntries);
}

export function dismissConsoleError(id: string): void {
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length !== entries.length) {
    entries = next;
    emit();
  }
}

function formatArgument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * A duplicate summary bumps the existing card's count instead of stacking a
 * second copy — a failing render loop should not carpet the screen in
 * identical toasts.
 */
function recordConsoleError(summary: string, detail: string): void {
  const now = new Date().toISOString();
  const existing = entries.find((entry) => entry.summary === summary);

  if (existing !== undefined) {
    entries = entries.map((entry) =>
      entry.id === existing.id ? { ...entry, count: entry.count + 1, lastSeenAt: now } : entry,
    );
  } else {
    nextId += 1;
    entries = [
      {
        id: `console-error-${String(nextId)}`,
        summary,
        detail,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      ...entries,
    ];
  }

  emit();
}

let installed = false;

/**
 * Wraps `console.error` once at startup. The original call still runs first,
 * so devtools output is unaffected; only the notification bookkeeping is new.
 */
export function installConsoleErrorCapture(): void {
  if (installed) {
    return;
  }
  installed = true;

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    originalError(...args);
    try {
      /*
       * React (and libraries following its convention) prefix dev-mode
       * advisories with "Warning:" and logs them through console.error even
       * though they are not user-facing failures. Capturing them risks a
       * feedback loop too: a warning fired by our own notification re-render
       * would otherwise queue another notification, and so on.
       */
      const firstArgument = args[0];
      if (typeof firstArgument === "string" && firstArgument.startsWith("Warning:")) {
        return;
      }

      const detail = args.map(formatArgument).join(" ");
      /*
       * An Error's own message reads better as the summary than the first
       * line of its stack, which repeats the message behind a class name.
       */
      const summarySource =
        firstArgument instanceof Error ? firstArgument.message : (detail.split("\n")[0] ?? detail);
      const summary = truncate(
        summarySource.length > 0 ? summarySource : "An unknown error occurred.",
        MAX_SUMMARY_LENGTH,
      );
      recordConsoleError(summary, detail);
    } catch {
      // Notification bookkeeping must never take down the original console.error call.
    }
  };
}

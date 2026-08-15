import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RecognitionSessionSummaryView } from "@stockcontrol/contracts";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SessionUnavailable } from "./SessionUnavailable";

const session = (
  over: Partial<RecognitionSessionSummaryView> = {},
): RecognitionSessionSummaryView => ({
  id: "session-1",
  status: "Failed",
  photoCount: 2,
  createdAt: "2026-08-10T09:00:00.000Z",
  expiresAt: "2026-08-10T15:00:00.000Z",
  committedItemId: null,
  failureCode: null,
  ...over,
});

const renderScreen = (
  over: Partial<RecognitionSessionSummaryView> = {},
): { onRetry: () => void; onBackToBatch: () => void } => {
  const onRetry = vi.fn();
  const onBackToBatch = vi.fn();

  render(
    <MemoryRouter>
      <SessionUnavailable
        session={session(over)}
        onRetry={onRetry}
        onCancel={() => undefined}
        onBackToBatch={onBackToBatch}
      />
    </MemoryRouter>,
  );

  return { onRetry, onBackToBatch };
};

describe("SessionUnavailable", () => {
  /*
   * The previous copy told the person to "enter it yourself" on a screen with
   * no way to do that, and the server refuses a receipt against a session
   * that never reached review — so the instruction could not be followed.
   */
  it("offers ways forward that actually exist", async () => {
    const user = userEvent.setup();
    const { onRetry } = renderScreen();

    await user.click(screen.getByRole("button", { name: /photograph it again/iu }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /add it in inventory instead/iu })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });

  // The failure code has always been on the session and was never read, so
  // every way of failing produced one indistinguishable sentence.
  it("explains an unavailable recogniser differently from an unreadable photo", () => {
    renderScreen({ failureCode: "capture.recognition_unavailable" });

    expect(screen.getByText(/not available at the moment/iu)).toBeInTheDocument();
  });

  it("says an expired item was cleared away", () => {
    renderScreen({ status: "Expired" });

    expect(screen.getByText(/this item expired/iu)).toBeInTheDocument();
    expect(screen.getByText(/photographs were not kept/iu)).toBeInTheDocument();
  });

  it("does not offer to re-photograph something already added to stock", () => {
    renderScreen({ status: "Committed" });

    expect(screen.getByText(/already been added to stock/iu)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /photograph it again/iu })).not.toBeInTheDocument();
  });
});

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
      <SessionUnavailable session={session(over)} onRetry={onRetry} onBackToBatch={onBackToBatch} />
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

    expect(screen.getByText(/did not answer/iu)).toBeInTheDocument();
    /* Whose fault it is decides what the person does next. */
    expect(screen.getByText(/not a problem with your photographs/iu)).toBeInTheDocument();
  });

  /*
   * The 14 August staging incident ended with a person retaking the same
   * photograph. Re-photographing cannot fix a recogniser that is down, so the
   * button that will work is the one that has to look like the way out.
   */
  it("leads with inventory, not the camera, when the recogniser is the thing that failed", () => {
    renderScreen({ failureCode: "capture.recognition_unavailable" });

    expect(screen.getByRole("link", { name: /add it in inventory instead/iu })).toHaveClass(
      "MuiButton-contained",
    );
    expect(screen.getByRole("button", { name: /photograph it again/iu })).not.toHaveClass(
      "MuiButton-contained",
    );
  });

  it("leads with the camera when a better photograph is what is needed", () => {
    renderScreen({ failureCode: "capture.upload_invalid" });

    expect(screen.getByRole("button", { name: /photograph it again/iu })).toHaveClass(
      "MuiButton-contained",
    );
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

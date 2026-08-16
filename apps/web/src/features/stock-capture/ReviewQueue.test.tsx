import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  RecognitionSessionStatus,
  RecognitionSessionSummaryView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { howLongAgo, ReviewQueue } from "./ReviewQueue";

const session = (
  id: string,
  status: RecognitionSessionStatus,
  over: Partial<RecognitionSessionSummaryView> = {},
): RecognitionSessionSummaryView => ({
  id,
  status,
  photoCount: 2,
  createdAt: new Date().toISOString(),
  expiresAt: "2026-08-10T15:00:00.000Z",
  committedItemId: null,
  failureCode: null,
  ...over,
});

const batchOf = (...sessions: readonly RecognitionSessionSummaryView[]): StockCaptureBatchView => ({
  id: "batch-1",
  status: "Open",
  defaultLocationId: null,
  createdAt: "2026-08-10T09:00:00.000Z",
  closedAt: null,
  sessions,
  committedEntryCount: 0,
});

interface Handlers {
  readonly onScan?: () => void;
  readonly onOpenSession?: (session: RecognitionSessionSummaryView) => void;
  readonly onRemoveSession?: (session: RecognitionSessionSummaryView) => void;
  readonly onFinishDelivery?: () => void;
}

function renderQueue(batch: StockCaptureBatchView, handlers: Handlers = {}): void {
  render(
    <MemoryRouter>
      <ReviewQueue
        batch={batch}
        added={[]}
        locations={[]}
        defaultLocationId=""
        notice={null}
        error={null}
        finishing={false}
        onDefaultLocationChange={vi.fn()}
        onDismissNotice={vi.fn()}
        onScan={handlers.onScan ?? vi.fn()}
        onOpenSession={handlers.onOpenSession ?? vi.fn()}
        onRemoveSession={handlers.onRemoveSession ?? vi.fn()}
        onFinishDelivery={handlers.onFinishDelivery ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("the review queue", () => {
  /*
   * Grouped by what it wants from the reader, not by status: "Enriching" and
   * "Fusing" are the same fact to them — not ready yet — while one row wants
   * them now. A flat list made the reader work that out for themselves.
   */
  it("separates what is waiting for you from what is still working", () => {
    renderQueue(batchOf(session("a", "ReviewReady"), session("b", "Fusing")));

    const waiting = screen.getByRole("region", { name: /waiting for you/iu });
    expect(within(waiting).getByRole("button", { name: "Review" })).toBeEnabled();

    const working = screen.getByRole("region", { name: /still being read/iu });
    expect(within(working).getByText(/preparing suggestions/iu)).toBeInTheDocument();
  });

  it("puts what could not be read where it can be acted on", () => {
    renderQueue(batchOf(session("a", "Failed")));

    const stuck = screen.getByRole("region", { name: /could not be read/iu });
    expect(within(stuck).getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  /* Managing a queue means being able to clear something out of it without
   * opening it first to find out you cannot. */
  it("removes an item without opening it", async () => {
    const user = userEvent.setup();
    const onRemoveSession = vi.fn();
    renderQueue(batchOf(session("a", "ReviewReady")), { onRemoveSession });

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(onRemoveSession).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("leaves a committed session out of the queue entirely", () => {
    renderQueue(batchOf(session("a", "Committed", { committedItemId: "item-1" })));

    expect(screen.getByText(/nothing is waiting/iu)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /waiting for you/iu })).not.toBeInTheDocument();
  });

  it("will not finish a delivery with work still in it", () => {
    renderQueue(batchOf(session("a", "ReviewReady")));

    expect(screen.getByRole("button", { name: /finish this delivery/iu })).toBeDisabled();
    expect(screen.getByText(/review or remove everything above/iu)).toBeInTheDocument();
  });

  it("finishes a delivery once the queue is clear", async () => {
    const user = userEvent.setup();
    const onFinishDelivery = vi.fn();
    renderQueue(batchOf(), { onFinishDelivery });

    await user.click(screen.getByRole("button", { name: /finish this delivery/iu }));

    expect(onFinishDelivery).toHaveBeenCalledOnce();
  });

  it("explains an empty queue rather than showing an empty list", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    renderQueue(batchOf(), { onScan });

    expect(screen.getByText(/nothing is waiting/iu)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /photograph an item/iu }));

    expect(onScan).toHaveBeenCalledOnce();
  });
});

/* Which item is stuck is the question this page answers, and a timestamp makes
 * the reader do that arithmetic themselves. */
describe("howLongAgo", () => {
  const now = new Date("2026-08-16T12:00:00.000Z").getTime();
  const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString();

  it("says just now for the last minute", () => {
    expect(howLongAgo(ago(0), now)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(howLongAgo(ago(1), now)).toBe("1 minute ago");
    expect(howLongAgo(ago(45), now)).toBe("45 minutes ago");
    expect(howLongAgo(ago(60), now)).toBe("1 hour ago");
    expect(howLongAgo(ago(60 * 5), now)).toBe("5 hours ago");
    expect(howLongAgo(ago(60 * 24), now)).toBe("yesterday");
    expect(howLongAgo(ago(60 * 24 * 3), now)).toBe("3 days ago");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RecognitionSessionView } from "@stockcontrol/contracts";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { CandidateReview } from "./CandidateReview";

const unavailableSession: RecognitionSessionView = {
  id: "session-1",
  batchId: "batch-1",
  status: "ReviewReady",
  photoCount: 1,
  createdAt: "2026-08-14T09:35:55.000Z",
  expiresAt: "2026-08-14T15:35:55.000Z",
  committedItemId: null,
  failureCode: null,
  photos: [],
  detectedBarcodes: [],
  candidates: [],
  suggestedDraft: null,
  stageReports: [
    {
      stage: "Ocr",
      outcome: "Unavailable",
      imageOrdinal: 1,
      observations: ["The recognition service could not be reached."],
    },
  ],
  recommendManualEntry: true,
};

describe("CandidateReview", () => {
  it("explains when automatic recognition was unavailable", () => {
    render(
      <MemoryRouter>
        <CandidateReview
          session={unavailableSession}
          showDetails={false}
          onToggleDetails={() => undefined}
          onSelect={() => undefined}
          onManualEntry={() => undefined}
          onReviewLater={() => undefined}
          onCancel={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Automatic photo recognition was unavailable/u)).toBeInTheDocument();
  });

  it("continues to a pre-filled new-item form when recognised details exist", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const session: RecognitionSessionView = {
      ...unavailableSession,
      stageReports: [],
      suggestedDraft: {
        manufacturer: "Honeywell",
        name: "Excel 10 Fan Coil Controller",
        partNumber: "W7752E2004",
        barcode: "5023226600023",
        unit: null,
        variantAttributes: [],
      },
    };

    render(
      <MemoryRouter>
        <CandidateReview
          session={session}
          showDetails={false}
          onToggleDetails={() => undefined}
          onSelect={onSelect}
          onManualEntry={() => undefined}
          onReviewLater={() => undefined}
          onCancel={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/no existing stock match/iu)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onSelect).toHaveBeenCalledWith({
      kind: "NewItem",
      candidateId: null,
      reference: null,
      name: "Honeywell Excel 10 Fan Coil Controller",
      unit: "",
      barcode: "5023226600023",
      partNumber: "W7752E2004",
    });
  });
});

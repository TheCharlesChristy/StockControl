import { render, screen } from "@testing-library/react";
import type { RecognitionSessionView } from "@stockcontrol/contracts";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

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
  candidates: [],
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
          onCancel={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Automatic photo recognition was unavailable/u)).toBeInTheDocument();
  });
});

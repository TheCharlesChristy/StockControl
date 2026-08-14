import { render, screen } from "@testing-library/react";
import type { RecognitionAnalysisOutcome, RecognitionSessionView } from "@stockcontrol/contracts";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CandidateReview } from "./CandidateReview";

/*
 * The complaint this covers: a photograph was uploaded, the screen came back
 * with nothing, and there was no way to tell whether the pipeline had looked
 * and found nothing or had never looked at all. Both produced the same empty
 * screen, and the two call for opposite reactions — retake the photograph
 * versus tell an administrator the service is not configured.
 */

const sessionWith = (outcome: RecognitionAnalysisOutcome): RecognitionSessionView => ({
  id: "session-1",
  status: outcome === "Failed" ? "Failed" : "ReviewReady",
  photoCount: 2,
  createdAt: "2026-08-14T09:00:00.000Z",
  expiresAt: "2026-08-14T15:00:00.000Z",
  committedItemId: null,
  failureCode: null,
  batchId: "batch-1",
  candidates: [],
  stageReports: [],
  recommendManualEntry: true,
  analysisOutcome: outcome,
});

const renderReview = (outcome: RecognitionAnalysisOutcome): void => {
  render(
    <MemoryRouter>
      <CandidateReview
        session={sessionWith(outcome)}
        showDetails={false}
        onToggleDetails={() => undefined}
        onSelect={() => undefined}
        onManualEntry={() => undefined}
        onCancel={() => undefined}
      />
    </MemoryRouter>,
  );
};

describe("an empty candidate list", () => {
  it("says the photographs were analysed when the whole pipeline ran", () => {
    renderReview("Completed");

    expect(screen.getByText("No match found")).toBeInTheDocument();
    expect(
      screen.getByText(/were analysed and nothing in the catalogue matched/iu),
    ).toBeInTheDocument();
  });

  it("says so plainly when nothing examined the photographs", () => {
    renderReview("NotRun");

    expect(screen.getByText("The photographs were not analysed")).toBeInTheDocument();
    expect(screen.getByText(/no recognition service is set up/iu)).toBeInTheDocument();
    /* Whose problem it is matters: this one is not fixed by retaking a photo. */
    expect(screen.getByText(/configuration matter for your administrator/iu)).toBeInTheDocument();
  });

  it("warns that a half-run analysis is not a reliable no", () => {
    renderReview("Partial");

    expect(screen.getByText("Only part of the analysis ran")).toBeInTheDocument();
    expect(screen.getByText(/not a reliable/iu)).toBeInTheDocument();
  });

  it("distinguishes a run that broke from one that found nothing", () => {
    renderReview("Failed");

    expect(screen.getByText("The analysis did not finish")).toBeInTheDocument();
    expect(screen.queryByText("No match found")).not.toBeInTheDocument();
  });

  it("never shows the same words for two different outcomes", () => {
    const titles = (["Completed", "Partial", "NotRun", "Failed"] as const).map((outcome) => {
      const { unmount } = render(
        <MemoryRouter>
          <CandidateReview
            session={sessionWith(outcome)}
            showDetails={false}
            onToggleDetails={() => undefined}
            onSelect={() => undefined}
            onManualEntry={() => undefined}
            onCancel={() => undefined}
          />
        </MemoryRouter>,
      );
      const heading = screen.getByRole("alert").textContent;
      unmount();
      return heading;
    });

    expect(new Set(titles).size).toBe(titles.length);
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecognitionProgress } from "./RecognitionProgress";

describe("RecognitionProgress", () => {
  it("names the stage the session is actually at", () => {
    render(
      <RecognitionProgress
        status="ProcessingImages"
        checkFailures={0}
        onCheckNow={() => undefined}
        onQueueAnother={() => undefined}
        onBackToQueue={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Reading labels and image details…");
    expect(screen.getByLabelText("Recognition pipeline")).toHaveTextContent(
      "Read labels and image details",
    );
  });

  it("shows completed and upcoming stages around the current stage", () => {
    render(
      <RecognitionProgress
        status="Fusing"
        checkFailures={0}
        onCheckNow={() => undefined}
        onQueueAnother={() => undefined}
        onBackToQueue={() => undefined}
        onCancel={() => undefined}
      />,
    );

    const pipeline = screen.getByLabelText("Recognition pipeline");
    expect(pipeline).toHaveTextContent("Check upload and barcodes");
    expect(pipeline).toHaveTextContent("Check catalogue and web evidence");
    expect(pipeline).toHaveTextContent("Analyse the photo and prepare suggestions");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Running photo analysis and preparing suggestions…",
    );
  });

  it("keeps waiting quietly while the odd check fails", () => {
    render(
      <RecognitionProgress
        status="Queued"
        checkFailures={2}
        onCheckNow={() => undefined}
        onQueueAnother={() => undefined}
        onBackToQueue={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Waiting its turn…");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /*
   * The failures used to be swallowed entirely, so a person whose connection
   * had dropped watched an animated bar over a session nobody was asking
   * about any more, with nothing on screen ever saying so.
   */
  it("says so once the server has stopped answering, and offers a check now", async () => {
    const user = userEvent.setup();
    const onCheckNow = vi.fn();

    render(
      <RecognitionProgress
        status="Queued"
        checkFailures={3}
        onCheckNow={onCheckNow}
        onQueueAnother={() => undefined}
        onBackToQueue={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("cannot reach the server");
    await user.click(screen.getByRole("button", { name: /check now/iu }));

    expect(onCheckNow).toHaveBeenCalledOnce();
  });

  it("reassures that nothing has been lost while it cannot reach the server", () => {
    render(
      <RecognitionProgress
        status="Queued"
        checkFailures={5}
        onCheckNow={() => undefined}
        onQueueAnother={() => undefined}
        onBackToQueue={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/nothing has been lost/iu);
  });
});

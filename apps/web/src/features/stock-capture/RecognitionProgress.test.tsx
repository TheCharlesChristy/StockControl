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
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Reading the photographs…");
  });

  it("keeps waiting quietly while the odd check fails", () => {
    render(
      <RecognitionProgress
        status="Queued"
        checkFailures={2}
        onCheckNow={() => undefined}
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
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/nothing has been lost/iu);
  });
});

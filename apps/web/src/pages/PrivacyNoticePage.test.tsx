import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The page reads its installation details once, when the module loads, so
 * each case here imports it fresh after setting the environment it is about.
 */
const renderNotice = async (): Promise<void> => {
  vi.resetModules();
  const { PrivacyNoticePage } = await import("./PrivacyNoticePage");

  render(
    <MemoryRouter>
      <PrivacyNoticePage />
    </MemoryRouter>,
  );
};

describe("the privacy notice", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tells a person what is recorded, why, and for how long", async () => {
    await renderNotice();

    expect(
      screen.getByRole("heading", { name: "How StockControl uses your information" }),
    ).toBeInTheDocument();

    for (const heading of [
      "Who is responsible",
      "What is recorded about you",
      "Why it is allowed",
      "How long it is kept",
      "Who else sees it",
      "Cookies",
      "What you can ask for",
      "If something goes wrong",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  /*
   * A person has to be able to complain to the regulator directly, and has to
   * be told so. Losing this link is the kind of edit nobody notices.
   */
  it("points to the regulator", async () => {
    await renderNotice();

    expect(screen.getByRole("link", { name: "ico.org.uk" })).toHaveAttribute(
      "href",
      "https://ico.org.uk/make-a-complaint/",
    );
  });

  it("names the business and where to ask, once an installation has said", async () => {
    vi.stubEnv("VITE_DATA_CONTROLLER_NAME", "Christy Plumbing & Heating Ltd");
    vi.stubEnv("VITE_PRIVACY_CONTACT", "office@example.invalid");

    await renderNotice();

    expect(screen.getByText(/Christy Plumbing & Heating Ltd/u)).toBeInTheDocument();
    expect(screen.getByText(/office@example.invalid/u)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /*
   * A notice that names nobody is worse than no notice, because it looks like
   * an answer. If an installation has not been configured, the page says so
   * rather than quietly presenting a blank where the business should be.
   */
  it("says plainly when an installation has not said who is responsible", async () => {
    vi.stubEnv("VITE_DATA_CONTROLLER_NAME", "");
    vi.stubEnv("VITE_PRIVACY_CONTACT", "");

    await renderNotice();

    expect(
      screen.getByText(/has not recorded who is answerable for the information it holds/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask your manager/u)).toBeInTheDocument();
  });
});

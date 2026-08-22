import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIGNED_IN_PATH,
  getRedirectPath,
  requiresDocumentNavigation,
  signInPathFor,
} from "./SignInPage";

const ITEM = "/inventory/21290659-a871-46d5-94e0-c979de2afd4c";
const OAUTH_AUTHORIZE =
  "/oauth/authorize?response_type=code&client_id=stockcontrol-chatgpt&scope=stock%3Aread";

describe("signInPathFor", () => {
  it("remembers a deep link in the query string", () => {
    expect(signInPathFor(ITEM)).toBe(`/sign-in?next=${encodeURIComponent(ITEM)}`);
  });

  it("stays plain for anything that is not a deep link", () => {
    expect(signInPathFor("/inventory")).toBe("/sign-in");
    expect(signInPathFor("//evil.example.com")).toBe("/sign-in");
  });

  it("remembers an OAuth authorization request", () => {
    expect(signInPathFor(OAUTH_AUTHORIZE)).toBe(
      `/sign-in?next=${encodeURIComponent(OAUTH_AUTHORIZE)}`,
    );
  });
});

describe("getRedirectPath", () => {
  it("returns to a scanned item recorded in the query string", () => {
    /*
     * The case the demo journey exercises: arriving from a QR code is a full
     * page load, which discards router history state, so the query string is
     * the only carrier that survives.
     */
    expect(getRedirectPath(null, `?next=${encodeURIComponent(ITEM)}`)).toBe(ITEM);
  });

  it("round-trips whatever signInPathFor produced", () => {
    const search = signInPathFor(ITEM).slice("/sign-in".length);
    expect(getRedirectPath(undefined, search)).toBe(ITEM);
  });

  it("returns to the API route after OAuth sign-in", () => {
    const search = signInPathFor(OAUTH_AUTHORIZE).slice("/sign-in".length);

    expect(getRedirectPath(undefined, search)).toBe(OAUTH_AUTHORIZE);
    expect(requiresDocumentNavigation(OAUTH_AUTHORIZE)).toBe(true);
  });

  it("still honours router state, for in-app navigations", () => {
    expect(getRedirectPath({ from: ITEM })).toBe(ITEM);
  });

  it("prefers the query string when the two disagree", () => {
    expect(getRedirectPath({ from: "/jobs/abc" }, `?next=${encodeURIComponent(ITEM)}`)).toBe(ITEM);
  });

  it("falls back to the dashboard when nothing usable is offered", () => {
    expect(getRedirectPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(getRedirectPath({})).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(getRedirectPath({ from: "/inventory" })).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses to be pointed off-site or back at itself", () => {
    for (const hostile of [
      "//evil.example.com/inventory/1",
      "https://evil.example.com/inventory/1",
      "/\\evil.example.com",
      "/sign-in",
    ])
      expect(getRedirectPath(null, `?next=${encodeURIComponent(hostile)}`)).toBe(
        DEFAULT_SIGNED_IN_PATH,
      );
  });
});

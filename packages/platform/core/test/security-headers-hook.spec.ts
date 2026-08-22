import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerSecurityHeadersHook } from "../src/http/security-headers-hook";

type SendHook = (
  request: unknown,
  reply: {
    readonly header: (name: string, value: string) => void;
    readonly getHeader: (name: string) => unknown;
  },
  payload: unknown,
  done: (error: null, payload: unknown) => void,
) => void;

/** Registers the hook and returns it alongside the headers it sets. */
const runHookWith = (
  existingHeaders: Readonly<Record<string, string>> = {},
): { readonly headers: Map<string, string>; readonly payload: unknown } => {
  let hook: SendHook | undefined;
  const fastify = {
    addHook: vi.fn((name: string, handler: SendHook) => {
      expect(name).toBe("onSend");
      hook = handler;
    }),
  } as unknown as FastifyInstance;

  registerSecurityHeadersHook(fastify);

  const headers = new Map<string, string>(Object.entries(existingHeaders));
  let forwarded: unknown;

  hook?.(
    {},
    {
      header: (name, value) => headers.set(name, value),
      getHeader: (name) => headers.get(name),
    },
    "body",
    (_error, payload) => {
      forwarded = payload;
    },
  );

  return { headers, payload: forwarded };
};

describe("API security headers", () => {
  /*
   * The API serves image bytes a user uploaded. Without nosniff a browser is
   * free to decide a stored file is really HTML and run it on this origin.
   */
  it("stops the browser sniffing an uploaded file into something executable", () => {
    expect(runHookWith().headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("denies every resource and frame by default", () => {
    const policy = runHookWith().headers.get("content-security-policy");

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("keeps the document policy selected by a route", () => {
    const documentPolicy = "default-src 'none'; frame-ancestors https://chatgpt.com";

    expect(
      runHookWith({ "content-security-policy": documentPolicy }).headers.get(
        "content-security-policy",
      ),
    ).toBe(documentPolicy);
  });

  it("defaults an authenticated response to no-store", () => {
    expect(runHookWith().headers.get("cache-control")).toBe("no-store");
  });

  /*
   * The photo endpoints deliberately mark their assets privately cacheable.
   * A blanket no-store would undo that on every avatar in a list.
   */
  it("leaves a cache decision a handler already made", () => {
    const { headers } = runHookWith({ "cache-control": "private, max-age=60" });

    expect(headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("passes the payload through untouched", () => {
    expect(runHookWith().payload).toBe("body");
  });
});

import { describe, expect, it } from "vitest";

import { ApiClient, ApiError } from "./ApiClient";

const clientReturning = (response: Response): ApiClient =>
  new ApiClient(() => Promise.resolve(response));

describe("ApiClient error handling", () => {
  it("maps a Problem Details body onto ApiError", async () => {
    const client = clientReturning(
      new Response(
        JSON.stringify({ detail: "Choose a location.", code: "request.validation_failed" }),
        {
          status: 422,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(client.dashboard()).rejects.toMatchObject({
      status: 422,
      code: "request.validation_failed",
      message: "Choose a location.",
    });
  });

  /*
   * The reason this file exists. `JSON.parse` used to run before the status
   * was considered, so a proxy answering 502 with an HTML page threw a raw
   * SyntaxError — not an ApiError — and every caller in the app is written to
   * recognise ApiError and nothing else. The result was an unhandled failure
   * with a message about an unexpected token, which is no use to anybody.
   */
  it("turns an HTML gateway error into a readable ApiError", async () => {
    const client = clientReturning(
      new Response("<html><body><h1>502 Bad Gateway</h1></body></html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );

    const caught: unknown = await client.dashboard().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 502 });
    expect((caught as ApiError).message).not.toContain("JSON");
    expect((caught as ApiError).message).toMatch(/not responding properly/iu);
  });

  it("reports an unreadable success body rather than returning nonsense", async () => {
    const client = clientReturning(
      new Response("not json at all", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(client.dashboard()).rejects.toMatchObject({ code: "response.unreadable" });
  });

  it("accepts an empty body on a successful response", async () => {
    const client = clientReturning(new Response(null, { status: 204 }));

    await expect(client.dashboard()).resolves.toBeUndefined();
  });
});

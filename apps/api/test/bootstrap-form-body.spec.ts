import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerApiContentTypeParsers } from "../src/bootstrap";

describe("API form body parsing", () => {
  it("parses OAuth application/x-www-form-urlencoded requests over HTTP", async () => {
    const app = Fastify();
    registerApiContentTypeParsers(app);
    app.post("/oauth/token", (request) => request.body);

    const response = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "grant_type=authorization_code&client_id=stockcontrol-chatgpt&scope=stock%3Aread",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      grant_type: "authorization_code",
      client_id: "stockcontrol-chatgpt",
      scope: "stock:read",
    });
    await app.close();
  });
});

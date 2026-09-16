import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerApiContentTypeParsers } from "../src/bootstrap";

describe("API form body parsing", () => {
  it("parses OAuth application/x-www-form-urlencoded requests over HTTP", async () => {
    const app = Fastify();
    registerApiContentTypeParsers(app);
    let parsedBody: unknown;
    app.post("/oauth/token", (request, reply) => {
      parsedBody = request.body;
      return reply.code(204).send();
    });

    const response = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "grant_type=authorization_code&client_id=stockcontrol-chatgpt&scope=stock%3Aread",
    });

    expect(response.statusCode).toBe(204);
    expect(parsedBody).toEqual({
      grant_type: "authorization_code",
      client_id: "stockcontrol-chatgpt",
      scope: "stock:read",
    });
    await app.close();
  });
});

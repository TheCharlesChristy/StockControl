import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { attachSession } from "../src/auth/request-context";
import type { UsersService } from "../src/users/users.service";
import { UsersController } from "../src/users/users.controller";

const requestFor = (id: string, role: "Admin" | "Engineer" | "Office"): FastifyRequest => {
  const request = {} as FastifyRequest;

  attachSession(request, {
    user: {
      id,
      username: role.toLowerCase(),
      email: null,
      displayName: `${role} person`,
      role,
      profilePhotoUrl: null,
      mustChangePassword: false,
    },
    issuedAt: "2026-08-23T09:00:00.000Z",
    expiresAt: "2026-08-23T21:00:00.000Z",
  });

  return request;
};

const exported = {
  exportedAt: "2026-08-23T12:00:00.000Z",
  subject: { username: "engineer" },
  sections: [],
  notes: [],
};

const controllerFor = (
  personalDataExport = vi.fn().mockResolvedValue(exported),
): { controller: UsersController; personalDataExport: ReturnType<typeof vi.fn> } => ({
  controller: new UsersController({ personalDataExport } as unknown as UsersService),
  personalDataExport,
});

const replyStub = (): { reply: FastifyReply; headers: Record<string, string> } => {
  const headers: Record<string, string> = {};
  const reply = {
    header: (name: string, value: string) => {
      headers[name] = value;
      return reply;
    },
  } as unknown as FastifyReply;

  return { reply, headers };
};

describe("asking for a copy of someone's personal data", () => {
  /*
   * Article 15 is the individual's own right. Routing it through an Admin adds
   * a gatekeeper to an answer the system can give immediately, so a person
   * reaches their own record without any capability at all.
   */
  it("lets a person take their own, whatever their role", async () => {
    const { controller, personalDataExport } = controllerFor();
    const { reply } = replyStub();

    await expect(
      controller.personalData(requestFor("engineer-1", "Engineer"), "engineer-1", reply),
    ).resolves.toBe(exported);

    expect(personalDataExport).toHaveBeenCalledWith("engineer-1");
  });

  it("refuses somebody else's to a person who cannot manage users", async () => {
    const { controller, personalDataExport } = controllerFor();
    const { reply } = replyStub();

    await expect(
      controller.personalData(requestFor("engineer-1", "Engineer"), "someone-else", reply),
    ).rejects.toThrow(ApplicationFailureException);

    expect(personalDataExport).not.toHaveBeenCalled();
  });

  it("lets an Admin produce one for somebody who has left", async () => {
    const { controller, personalDataExport } = controllerFor();
    const { reply } = replyStub();

    await controller.personalData(requestFor("admin-1", "Admin"), "leaver-1", reply);

    expect(personalDataExport).toHaveBeenCalledWith("leaver-1");
  });

  /*
   * Offered as a file, and never cached. This is somebody's whole record, and
   * a browser tab of it left open on a shared device in a van is not what they
   * asked for.
   */
  it("hands it over as a download that is not stored", async () => {
    const { controller } = controllerFor();
    const { reply, headers } = replyStub();

    await controller.personalData(requestFor("engineer-1", "Engineer"), "engineer-1", reply);

    expect(headers["Content-Disposition"]).toBe(
      'attachment; filename="stockcontrol-personal-data-engineer.json"',
    );
    expect(headers["Cache-Control"]).toBe("no-store");
  });
});

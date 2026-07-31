import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type {
  UserActivityResponse,
  UserListResponse,
  UserResponse,
  UserRole,
} from "@stockcontrol/contracts";
import { userRoles, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { requireCapability } from "../auth/request-context";
import { bodyOf, readBoolean, readText } from "../inventory/request-parsing";
import type { UsersService } from "./users.service";

function readRole(value: string): UserRole | undefined {
  return userRoles.includes(value as UserRole) ? (value as UserRole) : undefined;
}

@Controller("users")
export class UsersController {
  public constructor(@Inject(API_TOKENS.usersService) private readonly users: UsersService) {}

  /*
   * Listing people is a read, not user management: Office needs it to filter a
   * log by who did something. Creating, editing and deleting stay with Admin.
   */
  @Get()
  public async list(@Req() request: FastifyRequest): Promise<UserListResponse> {
    requireCapability(request, "viewAllActivity");

    return { users: await this.users.list() };
  }

  @Get(":id/activity")
  public async activity(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<UserActivityResponse> {
    requireCapability(request, "manageUsers");

    return this.users.activity(id);
  }

  @Post()
  public async create(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<UserResponse> {
    requireCapability(request, "manageUsers");
    const body = bodyOf(rawBody);

    return {
      user: await this.users.create({
        email: readText(body, "email"),
        displayName: readText(body, "displayName"),
        role: readText(body, "role"),
        password: typeof body["password"] === "string" ? body["password"] : "",
      }),
    };
  }

  @Patch(":id")
  public async update(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<UserResponse> {
    const actor = requireCapability(request, "manageUsers");
    const body = bodyOf(rawBody);
    const roleText = readText(body, "role");
    const role = roleText.length === 0 ? undefined : readRole(roleText);
    const isActive = readBoolean(body, "isActive");

    if (roleText.length > 0 && role === undefined) {
      throw new ApplicationFailureException(
        validationFailed({ role: ["Choose Engineer, Office or Admin."] }),
      );
    }

    /* Nobody may disable or demote themselves and lock the demo. */
    if (actor.id === id && (isActive === false || (role !== undefined && role !== "Admin"))) {
      throw new ApplicationFailureException(
        validationFailed({ role: ["You cannot change your own role or disable yourself."] }),
      );
    }

    const displayName = readText(body, "displayName");
    const email = readText(body, "email");

    return {
      user: await this.users.update(id, {
        ...(email.length === 0 ? {} : { email }),
        ...(displayName.length === 0 ? {} : { displayName }),
        ...(role === undefined ? {} : { role }),
        ...(isActive === undefined ? {} : { isActive }),
      }),
    };
  }

  @Delete(":id")
  public async remove(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<{ readonly deleted: true }> {
    const actor = requireCapability(request, "manageUsers");

    if (actor.id === id) {
      throw new ApplicationFailureException(
        validationFailed({ user: ["You cannot delete your own account."] }),
      );
    }

    await this.users.remove(id);

    return { deleted: true };
  }
}

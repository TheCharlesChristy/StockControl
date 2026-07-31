import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { UserListResponse, UserResponse, UserRole } from "@stockcontrol/contracts";
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

  @Get()
  public async list(@Req() request: FastifyRequest): Promise<UserListResponse> {
    requireCapability(request, "manageUsers");

    return { users: await this.users.list() };
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

    return {
      user: await this.users.update(id, {
        ...(displayName.length === 0 ? {} : { displayName }),
        ...(role === undefined ? {} : { role }),
        ...(isActive === undefined ? {} : { isActive }),
      }),
    };
  }
}

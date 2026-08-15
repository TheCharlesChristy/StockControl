import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type {
  ImageUploadRequest,
  UserActivityResponse,
  UserListResponse,
  UserResponse,
  UserRole,
} from "@stockcontrol/contracts";
import { userRoles, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";
import type { FastifyReply } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { currentUser, requireCapability } from "../auth/request-context";
import {
  bodyOf,
  readBoolean,
  readClearableText,
  readText,
  requireText,
} from "../inventory/request-parsing";
import type { UsersService } from "./users.service";

function readRole(value: string): UserRole | undefined {
  return userRoles.includes(value as UserRole) ? (value as UserRole) : undefined;
}

@Controller("users")
export class UsersController {
  public constructor(@Inject(API_TOKENS.usersService) private readonly users: UsersService) {}

  @Get(":id/profile-photo")
  public async profilePhoto(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    this.requirePhotoAccess(request, id);
    const asset = await this.users.profilePhoto(id);
    return reply
      .type(asset.mediaType)
      .header("content-disposition", `inline; filename="${asset.fileName.replaceAll('"', "")}"`)
      .header("cache-control", "private, max-age=60")
      .send(asset.bytes);
  }

  @Post(":id/profile-photo")
  public async saveProfilePhoto(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<UserResponse> {
    this.requirePhotoAccess(request, id);
    const body = bodyOf(rawBody);
    const mediaType = body.mediaType;
    if (mediaType !== "image/png" && mediaType !== "image/jpeg") {
      throw new ApplicationFailureException(
        validationFailed({ mediaType: ["Use image/png or image/jpeg."] }),
      );
    }
    const input: ImageUploadRequest = {
      originalFileName: requireText(body, "originalFileName", "an image filename"),
      mediaType,
      contentBase64: requireText(body, "contentBase64", "image bytes"),
    };
    return { user: await this.users.saveProfilePhoto(id, input) };
  }

  @Delete(":id/profile-photo")
  public async deleteProfilePhoto(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<UserResponse> {
    this.requirePhotoAccess(request, id);
    return { user: await this.users.deleteProfilePhoto(id) };
  }

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
    const email = readText(body, "email");

    return {
      user: await this.users.create({
        username: readText(body, "username"),
        ...(email.length === 0 ? {} : { email }),
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
    /*
     * `readText` collapses "omitted" and "present but blank" to the same "",
     * which would make an explicit blank silently read as "unchanged" instead
     * of the rejection it deserves — a username cannot be cleared the way an
     * email address can.
     */
    const username = readClearableText(body, "username");
    if (username === null) {
      throw new ApplicationFailureException(validationFailed({ username: ["Enter a username."] }));
    }
    /* Emptying the address removes it, so blank cannot mean "unchanged" here. */
    const email = readClearableText(body, "email");

    return {
      user: await this.users.update(id, {
        ...(username === undefined ? {} : { username }),
        ...(email === undefined ? {} : { email }),
        ...(displayName.length === 0 ? {} : { displayName }),
        ...(role === undefined ? {} : { role }),
        ...(isActive === undefined ? {} : { isActive }),
      }),
    };
  }

  /**
   * Resetting somebody else's password. Admin only, and never your own: an
   * Admin changing their own password uses `/auth/password` and proves they
   * hold the current one, so this route cannot be used to skip that check.
   */
  @Post(":id/password")
  public async resetPassword(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<UserResponse> {
    const actor = requireCapability(request, "manageUsers");

    if (actor.id === id) {
      throw new ApplicationFailureException(
        validationFailed({
          newPassword: ["Change your own password from your profile, with your current one."],
        }),
      );
    }

    const body = bodyOf(rawBody);
    const newPassword = typeof body["newPassword"] === "string" ? body["newPassword"] : "";

    return { user: await this.users.resetPassword(id, newPassword) };
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

  private requirePhotoAccess(request: FastifyRequest, userId: string): void {
    if (currentUser(request).id !== userId) requireCapability(request, "manageUsers");
  }
}

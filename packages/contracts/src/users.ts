import type { UserRole } from "./auth";

export interface UserView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface UserListResponse {
  readonly users: readonly UserView[];
}

export interface CreateUserRequest {
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly password: string;
}

export interface UpdateUserRequest {
  readonly displayName?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
}

export interface UserResponse {
  readonly user: UserView;
}

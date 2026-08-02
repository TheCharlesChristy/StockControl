import type { UserRole } from "./auth";
import type { TransactionView } from "./inventory";
import type { ReservationView } from "./jobs";
import type { StockRequestView } from "./stock-requests";

export interface UserView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly profilePhotoUrl: string | null;
}

export type { ImageMediaType, ImageUploadRequest } from "./media";

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
  readonly email?: string;
  readonly displayName?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
}

export interface UserResponse {
  readonly user: UserView;
}

/** What one person has been doing, for the Admin's user detail screen. */
export interface UserActivityResponse {
  readonly user: UserView;
  readonly recentTransactions: readonly TransactionView[];
  readonly openReservations: readonly ReservationView[];
  readonly stockRequests: readonly StockRequestView[];
  readonly counts: {
    readonly transactions: number;
    readonly openReservations: number;
    readonly pendingRequests: number;
  };
}

// API Response types
export interface ApiResponse<T = unknown> {
  data: T;
  message?: string;
}

export interface ApiError {
  detail: string;
  status_code: number;
}

// Health check response
export interface HealthResponse {
  status: string;
  version: string;
}

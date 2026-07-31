export const API_TOKENS = {
  authenticationGuard: Symbol("auth.guard"),
  catalogueService: Symbol("inventory.catalogue-service"),
  dashboardService: Symbol("dashboard.service"),
  jobsService: Symbol("jobs.service"),
  sessionService: Symbol("auth.session-service"),
  stockRequestsService: Symbol("requests.stock-requests-service"),
  stockService: Symbol("inventory.stock-service"),
  usersService: Symbol("users.service"),
} as const;

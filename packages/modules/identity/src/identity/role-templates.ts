import { capabilityKeys, PERMISSION_CATALOGUE_VERSION, type Capability } from "./capabilities";

export const standardRoles = ["Engineer", "Office", "Admin"] as const;

export type UserRole = (typeof standardRoles)[number];

export interface RoleTemplate {
  readonly role: UserRole;
  readonly catalogueVersion: typeof PERMISSION_CATALOGUE_VERSION;
  readonly permissions: Readonly<Record<Capability, boolean>>;
}

const engineerGrants = [
  "inventory.view",
  "inventory.take",
  "inventory.condition.report",
  "jobs.view",
  "jobs.reservations.request",
  "jobs.reservations.collect",
  "jobs.reconciliation.submit",
  "custody.view.own",
  "custody.collect",
  "custody.transfers.request",
  "purchasing.request",
  "locations.view",
  "audit.view.own",
] as const satisfies readonly Capability[];

const officeGrants = [
  "inventory.view",
  "inventory.take",
  "inventory.catalogue.manage",
  "inventory.receive",
  "inventory.transfer",
  "inventory.adjust",
  "inventory.condition.report",
  "inventory.condition.resolve",
  "inventory.writeoff.request",
  "inventory.writeoff.approve",
  "inventory.labels.print",
  "jobs.view",
  "jobs.create",
  "jobs.reservations.request",
  "jobs.reservations.manage",
  "jobs.reservations.collect",
  "jobs.reconciliation.submit",
  "jobs.reconciliation.approve",
  "custody.view.own",
  "custody.view.all",
  "custody.allocations.manage",
  "custody.collect",
  "custody.transfers.request",
  "custody.transfers.approve",
  "custody.accept.on-behalf",
  "purchasing.request",
  "purchasing.view",
  "purchasing.process",
  "purchasing.buyer.approve-request",
  "purchasing.buyer.approve-order",
  "purchasing.receive",
  "purchasing.invoices.manage",
  "purchasing.payments.record",
  "locations.view",
  "locations.use",
  "stocktakes.start",
  "stocktakes.enter",
  "stocktakes.recount",
  "stocktakes.variance.approve",
  "stocktakes.adjustment.post",
  "reports.inventory",
  "reports.operational",
  "reports.export",
  "audit.view.own",
  "audit.view.operational",
] as const satisfies readonly Capability[];

const adminGrants = capabilityKeys;

const expectedGrantsByRole = {
  Engineer: new Set<Capability>(engineerGrants),
  Office: new Set<Capability>(officeGrants),
  Admin: new Set<Capability>(adminGrants),
} as const satisfies Readonly<Record<UserRole, ReadonlySet<Capability>>>;

function createPermissions(
  grantedCapabilities: ReadonlySet<Capability>,
): Readonly<Record<Capability, boolean>> {
  return Object.freeze(
    Object.fromEntries(
      capabilityKeys.map((capability) => [capability, grantedCapabilities.has(capability)]),
    ) as Record<Capability, boolean>,
  );
}

function createRoleTemplate(role: UserRole): RoleTemplate {
  return Object.freeze({
    role,
    catalogueVersion: PERMISSION_CATALOGUE_VERSION,
    permissions: createPermissions(expectedGrantsByRole[role]),
  });
}

export const roleTemplates = Object.freeze({
  Engineer: createRoleTemplate("Engineer"),
  Office: createRoleTemplate("Office"),
  Admin: createRoleTemplate("Admin"),
}) satisfies Readonly<Record<UserRole, RoleTemplate>>;

export interface RoleTemplateCandidate {
  readonly role?: unknown;
  readonly catalogueVersion?: unknown;
  readonly permissions?: Readonly<Record<string, unknown>>;
}

export type RoleTemplatesCandidate = Readonly<Record<string, RoleTemplateCandidate | undefined>>;

export type RoleTemplateValidationIssueCode =
  | "MissingRole"
  | "UnexpectedRole"
  | "RoleNameMismatch"
  | "CatalogueVersionMismatch"
  | "PermissionsRequired"
  | "MissingCapability"
  | "UnexpectedCapability"
  | "PermissionNotBoolean"
  | "PermissionDefaultMismatch";

export interface RoleTemplateValidationIssue {
  readonly code: RoleTemplateValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface RoleTemplateValidationResult {
  readonly valid: boolean;
  readonly issues: readonly RoleTemplateValidationIssue[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  code: RoleTemplateValidationIssueCode,
  path: string,
  message: string,
): RoleTemplateValidationIssue {
  return Object.freeze({ code, path, message });
}

export function validateRoleTemplates(
  templates: RoleTemplatesCandidate,
): RoleTemplateValidationResult {
  const issues: RoleTemplateValidationIssue[] = [];
  const knownRoles = new Set<string>(standardRoles);

  for (const suppliedRole of Object.keys(templates).sort()) {
    if (!knownRoles.has(suppliedRole)) {
      issues.push(
        issue(
          "UnexpectedRole",
          suppliedRole,
          `${suppliedRole} is not a standard StockControl role template.`,
        ),
      );
    }
  }

  for (const role of standardRoles) {
    const template = templates[role];

    if (template === undefined) {
      issues.push(issue("MissingRole", role, `${role} must have a role template.`));
      continue;
    }

    if (template.role !== role) {
      issues.push(
        issue(
          "RoleNameMismatch",
          `${role}.role`,
          `${role} must identify itself as the ${role} role.`,
        ),
      );
    }

    if (template.catalogueVersion !== PERMISSION_CATALOGUE_VERSION) {
      issues.push(
        issue(
          "CatalogueVersionMismatch",
          `${role}.catalogueVersion`,
          `${role} must use permission catalogue version ${PERMISSION_CATALOGUE_VERSION}.`,
        ),
      );
    }

    if (!isRecord(template.permissions)) {
      issues.push(
        issue("PermissionsRequired", `${role}.permissions`, `${role} permissions are required.`),
      );
      continue;
    }

    const knownCapabilities = new Set<string>(capabilityKeys);
    for (const suppliedCapability of Object.keys(template.permissions).sort()) {
      if (!knownCapabilities.has(suppliedCapability)) {
        issues.push(
          issue(
            "UnexpectedCapability",
            `${role}.permissions.${suppliedCapability}`,
            `${suppliedCapability} is not in permission catalogue version ${PERMISSION_CATALOGUE_VERSION}.`,
          ),
        );
      }
    }

    for (const capability of capabilityKeys) {
      if (!Object.hasOwn(template.permissions, capability)) {
        issues.push(
          issue(
            "MissingCapability",
            `${role}.permissions.${capability}`,
            `${role} must define ${capability}.`,
          ),
        );
        continue;
      }

      const suppliedDefault = template.permissions[capability];
      if (typeof suppliedDefault !== "boolean") {
        issues.push(
          issue(
            "PermissionNotBoolean",
            `${role}.permissions.${capability}`,
            `${role} must define ${capability} as a boolean role default.`,
          ),
        );
        continue;
      }

      const expectedDefault = expectedGrantsByRole[role].has(capability);
      if (suppliedDefault !== expectedDefault) {
        issues.push(
          issue(
            "PermissionDefaultMismatch",
            `${role}.permissions.${capability}`,
            `${role} must set ${capability} to ${String(expectedDefault)}.`,
          ),
        );
      }
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

export class RoleTemplateConfigurationError extends Error {
  public constructor(public readonly issues: readonly RoleTemplateValidationIssue[]) {
    super(`Role-template validation failed with ${String(issues.length)} issue(s).`);
    this.name = "RoleTemplateConfigurationError";
  }
}

export function assertRoleTemplatesValid(templates: RoleTemplatesCandidate): void {
  const validation = validateRoleTemplates(templates);
  if (!validation.valid) {
    throw new RoleTemplateConfigurationError(validation.issues);
  }
}

export function getRoleTemplate(role: UserRole): RoleTemplate {
  return roleTemplates[role];
}

assertRoleTemplatesValid(roleTemplates);

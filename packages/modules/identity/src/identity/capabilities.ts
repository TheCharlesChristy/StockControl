export const PERMISSION_CATALOGUE_VERSION = 1 as const;

export const capabilityGroups = [
  "inventory",
  "jobs",
  "custody",
  "purchasing",
  "locations",
  "stocktakes",
  "reports",
  "audit",
  "users",
  "administration",
] as const;

export type CapabilityGroup = (typeof capabilityGroups)[number];

export const capabilityKeys = [
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
  "jobs.override",
  "custody.view.own",
  "custody.view.all",
  "custody.allocations.manage",
  "custody.collect",
  "custody.transfers.request",
  "custody.transfers.approve",
  "custody.accept.on-behalf",
  "custody.override",
  "purchasing.request",
  "purchasing.view",
  "purchasing.process",
  "purchasing.buyer.approve-request",
  "purchasing.buyer.approve-order",
  "purchasing.receive",
  "purchasing.invoices.manage",
  "purchasing.payments.record",
  "purchasing.settings.manage",
  "purchasing.override",
  "locations.view",
  "locations.use",
  "locations.manage",
  "stocktakes.start",
  "stocktakes.enter",
  "stocktakes.recount",
  "stocktakes.variance.approve",
  "stocktakes.adjustment.post",
  "reports.inventory",
  "reports.operational",
  "reports.financial",
  "reports.export",
  "audit.view.own",
  "audit.view.operational",
  "audit.view.all",
  "audit.export",
  "users.view",
  "users.invite",
  "users.manage",
  "users.permissions.manage",
  "users.sessions.revoke",
  "users.mfa-recovery.approve",
  "administration.organisation.manage",
  "administration.safeguards.manage",
] as const;

export type Capability = (typeof capabilityKeys)[number];

export interface CapabilityDefinition {
  readonly key: Capability;
  readonly group: CapabilityGroup;
}

const groupByPrefix = {
  inventory: "inventory",
  jobs: "jobs",
  custody: "custody",
  purchasing: "purchasing",
  locations: "locations",
  stocktakes: "stocktakes",
  reports: "reports",
  audit: "audit",
  users: "users",
  administration: "administration",
} as const satisfies Readonly<Record<CapabilityGroup, CapabilityGroup>>;

function capabilityGroupFor(capability: Capability): CapabilityGroup {
  const prefix = capability.slice(0, capability.indexOf(".")) as CapabilityGroup;
  return groupByPrefix[prefix];
}

export const permissionCatalogue = Object.freeze({
  version: PERMISSION_CATALOGUE_VERSION,
  capabilities: Object.freeze(
    capabilityKeys.map((key): CapabilityDefinition =>
      Object.freeze({
        key,
        group: capabilityGroupFor(key),
      }),
    ),
  ),
});

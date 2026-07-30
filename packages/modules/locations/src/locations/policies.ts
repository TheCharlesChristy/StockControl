import type {
  LocationRecord,
  OperationalLocationKind,
  VanLocation,
  VanAssignmentActorRole,
} from "./directory.js";
import { createReason, type Reason } from "./value-objects.js";

export type GeneralFulfilmentIneligibility =
  | "ArchivedOrInactive"
  | "Container"
  | "DisabledStorage"
  | "JobSiteExcluded"
  | "QuarantineExcluded"
  | "RepairExcluded"
  | "TransitExcluded"
  | "VanExcluded";

export type GeneralFulfilmentDecision =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: GeneralFulfilmentIneligibility };

const isActive = (location: LocationRecord): boolean => location.status === "Active";

export const evaluateGeneralFulfilment = (location: LocationRecord): GeneralFulfilmentDecision => {
  if (!isActive(location)) {
    return { eligible: false, reason: "ArchivedOrInactive" };
  }
  switch (location.operationalKind) {
    case "Storage":
      return location.generalFulfilmentEnabled
        ? { eligible: true }
        : { eligible: false, reason: "DisabledStorage" };
    case "Container":
      return { eligible: false, reason: "Container" };
    case "Quarantine":
      return { eligible: false, reason: "QuarantineExcluded" };
    case "Repair":
      return { eligible: false, reason: "RepairExcluded" };
    case "Transit":
      return { eligible: false, reason: "TransitExcluded" };
    case "Van":
      return { eligible: false, reason: "VanExcluded" };
    case "VirtualJobSite":
      return { eligible: false, reason: "JobSiteExcluded" };
  }
};

export type ReservationSourceSelection = "Automatic" | "Explicit";

export type ReservationSourceDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | GeneralFulfilmentIneligibility
        | "SilentVanSourcingForbidden"
        | "VanRequiresSeparateIssueOrTransfer";
    };

export const evaluateReservationSource = (
  location: LocationRecord,
  selection: ReservationSourceSelection,
): ReservationSourceDecision => {
  if (location.operationalKind === "Van") {
    return selection === "Automatic"
      ? { allowed: false, reason: "SilentVanSourcingForbidden" }
      : { allowed: false, reason: "VanRequiresSeparateIssueOrTransfer" };
  }
  const fulfilment = evaluateGeneralFulfilment(location);
  return fulfilment.eligible ? { allowed: true } : { allowed: false, reason: fulfilment.reason };
};

export type StockReceiptDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "ArchivedOrInactive" | "Container" };

export const evaluateStockReceipt = (location: LocationRecord): StockReceiptDecision => {
  if (!isActive(location)) {
    return { allowed: false, reason: "ArchivedOrInactive" };
  }
  return location.operationalKind === "Container"
    ? { allowed: false, reason: "Container" }
    : { allowed: true };
};

export type VanMovementIntent =
  "EngineerIssueToJob" | "RecallToFulfilment" | "ProposedVanToJobTransfer";

export interface VanMovementInitiationFacts {
  readonly sourceVan: VanLocation;
  readonly destination: LocationRecord;
  readonly sourceSelection: ReservationSourceSelection;
  readonly intent: VanMovementIntent;
  readonly actorRole: VanAssignmentActorRole;
  readonly hasInitiateVanMovementPermission: boolean;
  readonly actorIsAssignedToSourceVan: boolean;
  readonly itemAccessPermitsEngineerIssue: boolean;
}

export type VanMovementInitiationDenial =
  | "ActorNotAssigned"
  | "DestinationNotEligible"
  | "EngineerIssueRequiresJobSite"
  | "ExplicitPermissionRequired"
  | "OfficeOrAdminRequired"
  | "SourceVanArchived"
  | "VanCannotBeAutomaticallySourced";

export type VanMovementInitiationDecision =
  | {
      readonly allowed: true;
      readonly completionRequired: "AssignedEngineerConfirmationOrAdminOverride";
    }
  | { readonly allowed: false; readonly reason: VanMovementInitiationDenial };

const isOfficeOrAdmin = (role: VanAssignmentActorRole): boolean =>
  role === "Office" || role === "Admin";

const destinationKind = (location: LocationRecord): OperationalLocationKind =>
  location.operationalKind;

export const evaluateVanMovementInitiation = (
  facts: VanMovementInitiationFacts,
): VanMovementInitiationDecision => {
  if (facts.sourceVan.status !== "Active") {
    return { allowed: false, reason: "SourceVanArchived" };
  }
  if (facts.sourceSelection !== "Explicit") {
    return { allowed: false, reason: "VanCannotBeAutomaticallySourced" };
  }
  if (!facts.hasInitiateVanMovementPermission) {
    return { allowed: false, reason: "ExplicitPermissionRequired" };
  }
  if (!evaluateStockReceipt(facts.destination).allowed) {
    return { allowed: false, reason: "DestinationNotEligible" };
  }

  if (facts.intent === "EngineerIssueToJob") {
    if (facts.actorRole !== "Engineer" || !facts.itemAccessPermitsEngineerIssue) {
      return { allowed: false, reason: "ExplicitPermissionRequired" };
    }
    if (!facts.actorIsAssignedToSourceVan) {
      return { allowed: false, reason: "ActorNotAssigned" };
    }
    if (destinationKind(facts.destination) !== "VirtualJobSite") {
      return { allowed: false, reason: "EngineerIssueRequiresJobSite" };
    }
  } else {
    if (!isOfficeOrAdmin(facts.actorRole)) {
      return { allowed: false, reason: "OfficeOrAdminRequired" };
    }
    if (
      facts.intent === "RecallToFulfilment" &&
      !evaluateGeneralFulfilment(facts.destination).eligible
    ) {
      return { allowed: false, reason: "DestinationNotEligible" };
    }
    if (
      facts.intent === "ProposedVanToJobTransfer" &&
      destinationKind(facts.destination) !== "VirtualJobSite"
    ) {
      return { allowed: false, reason: "DestinationNotEligible" };
    }
  }
  return {
    allowed: true,
    completionRequired: "AssignedEngineerConfirmationOrAdminOverride",
  };
};

export interface VanMovementCompletionFacts {
  readonly initiationAllowed: boolean;
  readonly actorRole: VanAssignmentActorRole;
  readonly actorIsAssignedToSourceVan: boolean;
  readonly hasConfirmVanMovementPermission: boolean;
  readonly hasAdminOverridePermission: boolean;
  readonly adminOverrideReason?: Reason;
}

export type VanMovementCompletionDecision =
  | { readonly allowed: true; readonly completion: "EngineerConfirmed" }
  | { readonly allowed: true; readonly completion: "AdminOverride"; readonly reason: Reason }
  | {
      readonly allowed: false;
      readonly reason:
        | "AssignedEngineerConfirmationRequired"
        | "AuthorizedInitiationRequired"
        | "ExplicitPermissionRequired"
        | "ReasonedAdminOverrideRequired";
    };

export const evaluateVanMovementCompletion = (
  facts: VanMovementCompletionFacts,
): VanMovementCompletionDecision => {
  if (!facts.initiationAllowed) {
    return { allowed: false, reason: "AuthorizedInitiationRequired" };
  }
  if (facts.actorRole === "Engineer") {
    if (!facts.hasConfirmVanMovementPermission) {
      return { allowed: false, reason: "ExplicitPermissionRequired" };
    }
    return facts.actorIsAssignedToSourceVan
      ? { allowed: true, completion: "EngineerConfirmed" }
      : { allowed: false, reason: "AssignedEngineerConfirmationRequired" };
  }
  if (facts.actorRole === "Admin") {
    if (!facts.hasAdminOverridePermission || facts.adminOverrideReason === undefined) {
      return { allowed: false, reason: "ReasonedAdminOverrideRequired" };
    }
    try {
      const reason = createReason(facts.adminOverrideReason);
      return { allowed: true, completion: "AdminOverride", reason };
    } catch {
      return { allowed: false, reason: "ReasonedAdminOverrideRequired" };
    }
  }
  return { allowed: false, reason: "AssignedEngineerConfirmationRequired" };
};

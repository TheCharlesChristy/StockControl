import { describe, expect, it } from "vitest";

import {
  createJobId,
  createLocationCode,
  createLocationName,
  createReason,
  evaluateGeneralFulfilment,
  evaluateReservationSource,
  evaluateStockReceipt,
  evaluateVanMovementCompletion,
  evaluateVanMovementInitiation,
  type LocationRecord,
  type LocationDirectory,
  type VanMovementInitiationFacts,
} from "../src/index.js";
import {
  addVanAndJobSite,
  areaId,
  branchId,
  buildingOneId,
  customSectionId,
  directoryWithBuildings,
  engineerFact,
  engineerOne,
  jobSiteId,
  locationId,
  officeAuthorization,
  populatedDirectory,
  vanId,
} from "./helpers.js";

const policyDirectory = (): LocationDirectory => {
  const directory = populatedDirectory();
  addVanAndJobSite(directory);
  directory.addHierarchyNode({
    id: locationId(201),
    code: createLocationCode("REPAIR"),
    name: createLocationName("Repair"),
    nodeKind: "CustomSection",
    operationalKind: "Repair",
    parentId: areaId,
  });
  directory.addHierarchyNode({
    id: locationId(202),
    code: createLocationCode("TRANSIT"),
    name: createLocationName("Transit"),
    nodeKind: "CustomSection",
    operationalKind: "Transit",
    parentId: areaId,
  });
  directory.addHierarchyNode({
    id: locationId(203),
    code: createLocationCode("DISABLED"),
    name: createLocationName("Disabled storage"),
    nodeKind: "CustomSection",
    operationalKind: "Storage",
    parentId: areaId,
  });
  return directory;
};

describe("general fulfilment and reservation sourcing", () => {
  it("allows only explicitly enabled active Storage locations", () => {
    const directory = policyDirectory();
    expect(evaluateGeneralFulfilment(directory.getHierarchyNode(areaId)!)).toEqual({
      eligible: true,
    });
    const expected = new Map<string, string>([
      [branchId, "Container"],
      [customSectionId, "QuarantineExcluded"],
      [locationId(201), "RepairExcluded"],
      [locationId(202), "TransitExcluded"],
      [locationId(203), "DisabledStorage"],
      [vanId, "VanExcluded"],
      [jobSiteId, "JobSiteExcluded"],
    ]);
    for (const [id, reason] of expected) {
      const location =
        directory.getHierarchyNode(id as typeof branchId) ??
        directory.getVan(id as typeof vanId) ??
        directory.getJobSiteForJob(createJobId("job.1"));
      expect(evaluateGeneralFulfilment(location!)).toEqual({ eligible: false, reason });
    }

    const archivedStorage = directory.addHierarchyNode({
      id: locationId(204),
      code: createLocationCode("ARCHIVED-STORAGE"),
      name: createLocationName("Archived storage"),
      nodeKind: "CustomSection",
      operationalKind: "Storage",
      parentId: buildingOneId,
      generalFulfilmentEnabled: true,
    });
    directory.retireHierarchyNode(archivedStorage.id, {
      occupied: true,
      historicallyReferenced: true,
    });
    expect(evaluateGeneralFulfilment(directory.getHierarchyNode(archivedStorage.id)!)).toEqual({
      eligible: false,
      reason: "ArchivedOrInactive",
    });
    directory.deactivateVirtualJobSite(createJobId("job.1"), {
      jobStatus: "Completed",
      empty: true,
    });
    expect(evaluateGeneralFulfilment(directory.getJobSiteForJob(createJobId("job.1"))!)).toEqual({
      eligible: false,
      reason: "ArchivedOrInactive",
    });
  });

  it("never treats van stock as reservation supply, even when explicitly selected", () => {
    const directory = policyDirectory();
    const van = directory.getVan(vanId)!;
    expect(evaluateReservationSource(van, "Automatic")).toEqual({
      allowed: false,
      reason: "SilentVanSourcingForbidden",
    });
    expect(evaluateReservationSource(van, "Explicit")).toEqual({
      allowed: false,
      reason: "VanRequiresSeparateIssueOrTransfer",
    });
    expect(evaluateReservationSource(directory.getHierarchyNode(areaId)!, "Automatic")).toEqual({
      allowed: true,
    });
    expect(
      evaluateReservationSource(directory.getHierarchyNode(customSectionId)!, "Explicit"),
    ).toEqual({ allowed: false, reason: "QuarantineExcluded" });
  });

  it("allows stock receipt into concrete active holdings but never abstract containers", () => {
    const directory = policyDirectory();
    for (const location of [
      directory.getHierarchyNode(areaId)!,
      directory.getHierarchyNode(customSectionId)!,
      directory.getHierarchyNode(locationId(201))!,
      directory.getHierarchyNode(locationId(202))!,
      directory.getVan(vanId)!,
      directory.getJobSiteForJob(createJobId("job.1"))!,
    ]) {
      expect(evaluateStockReceipt(location)).toEqual({ allowed: true });
    }
    expect(evaluateStockReceipt(directory.getHierarchyNode(buildingOneId)!)).toEqual({
      allowed: false,
      reason: "Container",
    });
    directory.archiveVan(vanId);
    expect(evaluateStockReceipt(directory.getVan(vanId)!)).toEqual({
      allowed: false,
      reason: "ArchivedOrInactive",
    });
  });
});

describe("explicit van-stock movement authorization", () => {
  const facts = (
    overrides: Partial<VanMovementInitiationFacts> = {},
  ): VanMovementInitiationFacts => {
    const directory = policyDirectory();
    return {
      sourceVan: directory.getVan(vanId)!,
      destination: directory.getJobSiteForJob(createJobId("job.1"))!,
      sourceSelection: "Explicit",
      intent: "EngineerIssueToJob",
      actorRole: "Engineer",
      hasInitiateVanMovementPermission: true,
      actorIsAssignedToSourceVan: true,
      itemAccessPermitsEngineerIssue: true,
      ...overrides,
    };
  };

  it("permits an assigned, explicitly capable Engineer to issue permitted stock to a Job", () => {
    expect(evaluateVanMovementInitiation(facts())).toEqual({
      allowed: true,
      completionRequired: "AssignedEngineerConfirmationOrAdminOverride",
    });
  });

  it("rejects archived or automatically sourced vans and missing explicit permission", () => {
    const directory = policyDirectory();
    directory.archiveVan(vanId);
    expect(evaluateVanMovementInitiation(facts({ sourceVan: directory.getVan(vanId)! }))).toEqual({
      allowed: false,
      reason: "SourceVanArchived",
    });
    expect(evaluateVanMovementInitiation(facts({ sourceSelection: "Automatic" }))).toEqual({
      allowed: false,
      reason: "VanCannotBeAutomaticallySourced",
    });
    expect(
      evaluateVanMovementInitiation(facts({ hasInitiateVanMovementPermission: false })),
    ).toEqual({ allowed: false, reason: "ExplicitPermissionRequired" });
  });

  it("requires Engineer assignment, item access, and an active Job-site destination", () => {
    const directory = policyDirectory();
    expect(evaluateVanMovementInitiation(facts({ actorIsAssignedToSourceVan: false }))).toEqual({
      allowed: false,
      reason: "ActorNotAssigned",
    });
    expect(evaluateVanMovementInitiation(facts({ itemAccessPermitsEngineerIssue: false }))).toEqual(
      { allowed: false, reason: "ExplicitPermissionRequired" },
    );
    expect(
      evaluateVanMovementInitiation(
        facts({
          actorRole: "Office",
          itemAccessPermitsEngineerIssue: true,
        }),
      ),
    ).toEqual({ allowed: false, reason: "ExplicitPermissionRequired" });
    expect(
      evaluateVanMovementInitiation(facts({ destination: directory.getHierarchyNode(areaId)! })),
    ).toEqual({ allowed: false, reason: "EngineerIssueRequiresJobSite" });
    expect(
      evaluateVanMovementInitiation(facts({ destination: directory.getHierarchyNode(branchId)! })),
    ).toEqual({ allowed: false, reason: "DestinationNotEligible" });
  });

  it("allows permitted Office/Admin proposals but not role-only or invalid routes", () => {
    const directory = policyDirectory();
    const storage = directory.getHierarchyNode(areaId)!;
    expect(
      evaluateVanMovementInitiation(
        facts({
          intent: "RecallToFulfilment",
          actorRole: "Office",
          actorIsAssignedToSourceVan: false,
          destination: storage,
        }),
      ),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateVanMovementInitiation(
        facts({
          intent: "RecallToFulfilment",
          actorRole: "Engineer",
          destination: storage,
        }),
      ),
    ).toEqual({ allowed: false, reason: "OfficeOrAdminRequired" });
    expect(
      evaluateVanMovementInitiation(
        facts({
          intent: "RecallToFulfilment",
          actorRole: "Admin",
          destination: directory.getHierarchyNode(customSectionId)!,
        }),
      ),
    ).toEqual({ allowed: false, reason: "DestinationNotEligible" });
    expect(
      evaluateVanMovementInitiation(
        facts({
          intent: "ProposedVanToJobTransfer",
          actorRole: "Admin",
        }),
      ),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateVanMovementInitiation(
        facts({
          intent: "ProposedVanToJobTransfer",
          actorRole: "Office",
          destination: storage,
        }),
      ),
    ).toEqual({ allowed: false, reason: "DestinationNotEligible" });
  });
});

describe("physical van movement completion", () => {
  const base = {
    initiationAllowed: true,
    actorRole: "Engineer" as const,
    actorIsAssignedToSourceVan: true,
    hasConfirmVanMovementPermission: true,
    hasAdminOverridePermission: false,
  };

  it("requires the assigned Engineer's explicit confirmation capability", () => {
    expect(evaluateVanMovementCompletion(base)).toEqual({
      allowed: true,
      completion: "EngineerConfirmed",
    });
    expect(evaluateVanMovementCompletion({ ...base, initiationAllowed: false })).toEqual({
      allowed: false,
      reason: "AuthorizedInitiationRequired",
    });
    expect(
      evaluateVanMovementCompletion({
        ...base,
        hasConfirmVanMovementPermission: false,
      }),
    ).toEqual({ allowed: false, reason: "ExplicitPermissionRequired" });
    expect(
      evaluateVanMovementCompletion({
        ...base,
        actorIsAssignedToSourceVan: false,
      }),
    ).toEqual({ allowed: false, reason: "AssignedEngineerConfirmationRequired" });
  });

  it("allows only an explicitly capable Admin with a validated reason to override", () => {
    expect(
      evaluateVanMovementCompletion({
        ...base,
        actorRole: "Admin",
        hasAdminOverridePermission: true,
        adminOverrideReason: createReason("Engineer unavailable; Office verified handover."),
      }),
    ).toEqual({
      allowed: true,
      completion: "AdminOverride",
      reason: "Engineer unavailable; Office verified handover.",
    });
    expect(
      evaluateVanMovementCompletion({
        ...base,
        actorRole: "Admin",
        hasAdminOverridePermission: false,
      }),
    ).toEqual({ allowed: false, reason: "ReasonedAdminOverrideRequired" });
    expect(
      evaluateVanMovementCompletion({
        ...base,
        actorRole: "Admin",
        hasAdminOverridePermission: true,
      }),
    ).toEqual({ allowed: false, reason: "ReasonedAdminOverrideRequired" });
    expect(
      evaluateVanMovementCompletion({
        ...base,
        actorRole: "Admin",
        hasAdminOverridePermission: true,
        adminOverrideReason: " " as ReturnType<typeof createReason>,
      }),
    ).toEqual({ allowed: false, reason: "ReasonedAdminOverrideRequired" });
    expect(
      evaluateVanMovementCompletion({
        ...base,
        actorRole: "Office",
      }),
    ).toEqual({ allowed: false, reason: "AssignedEngineerConfirmationRequired" });
  });
});

describe("policy inputs remain independent of foreign modules", () => {
  it("uses supplied projections and opaque IDs without importing inventory or identity", () => {
    const directory = directoryWithBuildings();
    directory.addVan(
      {
        id: vanId,
        code: createLocationCode("VAN-1"),
        name: createLocationName("Van"),
        assignments: [engineerFact(engineerOne)],
        primaryEngineerId: engineerOne,
      },
      officeAuthorization,
    );
    const record: LocationRecord = directory.getVan(vanId)!;
    expect(record.operationalKind).toBe("Van");
  });
});

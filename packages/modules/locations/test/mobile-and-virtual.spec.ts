import { describe, expect, it } from "vitest";

import {
  LocationDirectory,
  LocationDomainError,
  createJobId,
  createLocationCode,
  createLocationName,
  type LocationDirectorySnapshot,
} from "../src/index.js";
import {
  addVanAndJobSite,
  buildingOneId,
  directoryWithBuildings,
  engineerFact,
  engineerOne,
  engineerTwo,
  jobSiteId,
  locationId,
  officeAuthorization,
  populatedDirectory,
  vanId,
} from "./helpers.js";

const expectDomainCode = (operation: () => unknown, code: string): void => {
  try {
    operation();
    throw new Error("Expected operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(LocationDomainError);
    expect(error).toMatchObject({ code });
  }
};

describe("persistent Engineer van locations", () => {
  it("creates a van with an exact active Engineer set and named primary", () => {
    const directory = directoryWithBuildings();
    const van = directory.addVan(
      {
        id: vanId,
        code: createLocationCode("VAN-1"),
        name: createLocationName("Service van"),
        assignments: [engineerFact(engineerTwo), engineerFact(engineerOne)],
        primaryEngineerId: engineerOne,
      },
      officeAuthorization,
    );

    expect(van).toMatchObject({
      operationalKind: "Van",
      branchId: directory.branchId,
      status: "Active",
      assignedEngineerIds: [engineerOne, engineerTwo],
      primaryEngineerId: engineerOne,
    });
    const copy = directory.getVan(vanId)!;
    (copy.assignedEngineerIds as unknown as string[]).pop();
    expect(directory.getVan(vanId)!.assignedEngineerIds).toHaveLength(2);
    expect(directory.getVan(locationId(999))).toBeUndefined();
  });

  it("requires both an appropriate actor role and explicit assignment capability", () => {
    const input = {
      id: vanId,
      code: createLocationCode("VAN-1"),
      name: createLocationName("Service van"),
      assignments: [engineerFact()],
      primaryEngineerId: engineerOne,
    };
    for (const authorization of [
      { actorRole: "Engineer" as const, hasManageVanAssignmentsPermission: true },
      { actorRole: "Office" as const, hasManageVanAssignmentsPermission: false },
      { actorRole: "Admin" as const, hasManageVanAssignmentsPermission: false },
    ]) {
      expectDomainCode(
        () => directoryWithBuildings().addVan(input, authorization),
        "PermissionDenied",
      );
    }
    expect(
      directoryWithBuildings().addVan(input, {
        actorRole: "Admin",
        hasManageVanAssignmentsPermission: true,
      }).id,
    ).toBe(vanId);
  });

  it("rejects empty, duplicate, inactive, non-Engineer, and missing-primary assignments", () => {
    const base = {
      id: vanId,
      code: createLocationCode("VAN-1"),
      name: createLocationName("Van"),
      primaryEngineerId: engineerOne,
    };
    const invalidAssignments = [
      [],
      [engineerFact(), engineerFact()],
      [engineerFact(engineerOne, { active: false })],
      [engineerFact(engineerOne, { role: "Office" })],
    ];
    for (const assignments of invalidAssignments) {
      expectDomainCode(
        () => directoryWithBuildings().addVan({ ...base, assignments }, officeAuthorization),
        "InvalidAssignment",
      );
    }
    expectDomainCode(
      () =>
        directoryWithBuildings().addVan(
          { ...base, assignments: [engineerFact(engineerTwo)] },
          officeAuthorization,
        ),
      "InvalidAssignment",
    );
  });

  it("replaces the complete set atomically and never allows the final Engineer to disappear", () => {
    const directory = directoryWithBuildings();
    directory.addVan(
      {
        id: vanId,
        code: createLocationCode("VAN-1"),
        name: createLocationName("Van"),
        assignments: [engineerFact(), engineerFact(engineerTwo)],
        primaryEngineerId: engineerOne,
      },
      officeAuthorization,
    );
    expect(
      directory.replaceVanAssignments(
        vanId,
        {
          assignments: [engineerFact(engineerTwo)],
          primaryEngineerId: engineerTwo,
        },
        officeAuthorization,
      ),
    ).toMatchObject({
      assignedEngineerIds: [engineerTwo],
      primaryEngineerId: engineerTwo,
    });
    expectDomainCode(
      () =>
        directory.replaceVanAssignments(
          vanId,
          { assignments: [], primaryEngineerId: engineerTwo },
          officeAuthorization,
        ),
      "InvalidAssignment",
    );
    expectDomainCode(
      () =>
        directory.replaceVanAssignments(
          vanId,
          {
            assignments: [engineerFact(engineerTwo)],
            primaryEngineerId: engineerTwo,
          },
          officeAuthorization,
        ),
      "NoChange",
    );
    expectDomainCode(
      () =>
        directory.replaceVanAssignments(
          locationId(999),
          {
            assignments: [engineerFact()],
            primaryEngineerId: engineerOne,
          },
          officeAuthorization,
        ),
      "MissingEntity",
    );
  });

  it("archives rather than deleting a persistent van and retains assignment history", () => {
    const directory = directoryWithBuildings();
    directory.addVan(
      {
        id: vanId,
        code: createLocationCode("VAN-1"),
        name: createLocationName("Van"),
        assignments: [engineerFact()],
        primaryEngineerId: engineerOne,
      },
      officeAuthorization,
    );
    expect(directory.renameLocation(vanId, createLocationName("Renamed van")).name).toBe(
      "Renamed van",
    );
    const archived = directory.archiveVan(vanId);
    expect(archived).toMatchObject({
      status: "Archived",
      assignedEngineerIds: [engineerOne],
      code: "VAN-1",
    });
    expectDomainCode(() => directory.archiveVan(vanId), "ArchivedEntity");
    expectDomainCode(
      () =>
        directory.replaceVanAssignments(
          vanId,
          {
            assignments: [engineerFact(engineerTwo)],
            primaryEngineerId: engineerTwo,
          },
          officeAuthorization,
        ),
      "ArchivedEntity",
    );
    expectDomainCode(
      () => directory.renameLocation(vanId, createLocationName("No")),
      "ArchivedEntity",
    );
    expectDomainCode(() => directory.archiveVan(locationId(999)), "MissingEntity");
  });

  it("enforces global location identity and code uniqueness across physical and mobile records", () => {
    const directory = populatedDirectory();
    expectDomainCode(
      () =>
        directory.addVan(
          {
            id: buildingOneId,
            code: createLocationCode("VAN-X"),
            name: createLocationName("Duplicate id"),
            assignments: [engineerFact()],
            primaryEngineerId: engineerOne,
          },
          officeAuthorization,
        ),
      "DuplicateEntity",
    );
    expectDomainCode(
      () =>
        directory.addVan(
          {
            id: vanId,
            code: createLocationCode("BLD-1"),
            name: createLocationName("Duplicate code"),
            assignments: [engineerFact()],
            primaryEngineerId: engineerOne,
          },
          officeAuthorization,
        ),
      "CodeAlreadyUsed",
    );
  });
});

describe("one virtual job-site location per Job", () => {
  it("creates one active virtual location and keeps its identity outside map geometry", () => {
    const directory = directoryWithBuildings();
    const jobId = createJobId("job.42");
    const site = directory.addVirtualJobSite({
      id: jobSiteId,
      code: createLocationCode("JOB-42"),
      name: createLocationName("Customer site"),
      jobId,
    });
    expect(site).toEqual({
      id: jobSiteId,
      code: "JOB-42",
      name: "Customer site",
      operationalKind: "VirtualJobSite",
      branchId: directory.branchId,
      jobId,
      status: "Active",
    });
    expect(directory.getJobSiteForJob(jobId)).toEqual(site);
    expect(directory.getJobSiteForJob(createJobId("job.missing"))).toBeUndefined();
    expect(directory.renameLocation(jobSiteId, createLocationName("New customer site")).name).toBe(
      "New customer site",
    );
  });

  it("deactivates only after closure and an independently confirmed empty balance", () => {
    const directory = directoryWithBuildings();
    const jobId = createJobId("job.42");
    directory.addVirtualJobSite({
      id: jobSiteId,
      code: createLocationCode("JOB-42"),
      name: createLocationName("Customer site"),
      jobId,
    });
    expectDomainCode(
      () => directory.deactivateVirtualJobSite(jobId, { jobStatus: "Active", empty: true }),
      "InvalidOperation",
    );
    expectDomainCode(
      () =>
        directory.deactivateVirtualJobSite(jobId, {
          jobStatus: "Completed",
          empty: false,
        }),
      "LocationNotEmpty",
    );
    expect(
      directory.deactivateVirtualJobSite(jobId, {
        jobStatus: "Cancelled",
        empty: true,
      }).status,
    ).toBe("Inactive");
    expectDomainCode(
      () =>
        directory.deactivateVirtualJobSite(jobId, {
          jobStatus: "Cancelled",
          empty: true,
        }),
      "ArchivedEntity",
    );
    expectDomainCode(
      () => directory.renameLocation(jobSiteId, createLocationName("Cannot change history")),
      "ArchivedEntity",
    );
  });

  it("never creates a replacement site for the same Job, including after deactivation", () => {
    const directory = directoryWithBuildings();
    const jobId = createJobId("job.42");
    directory.addVirtualJobSite({
      id: jobSiteId,
      code: createLocationCode("JOB-42"),
      name: createLocationName("Customer site"),
      jobId,
    });
    expectDomainCode(
      () =>
        directory.addVirtualJobSite({
          id: locationId(81),
          code: createLocationCode("JOB-42-B"),
          name: createLocationName("Duplicate site"),
          jobId,
        }),
      "DuplicateEntity",
    );
    directory.deactivateVirtualJobSite(jobId, { jobStatus: "Completed", empty: true });
    expectDomainCode(
      () =>
        directory.addVirtualJobSite({
          id: locationId(82),
          code: createLocationCode("JOB-42-C"),
          name: createLocationName("Replacement site"),
          jobId,
        }),
      "DuplicateEntity",
    );
    expectDomainCode(
      () =>
        directory.deactivateVirtualJobSite(createJobId("job.missing"), {
          jobStatus: "Completed",
          empty: true,
        }),
      "MissingEntity",
    );
  });

  it("searches globally by stable code across hierarchy, van, and job site", () => {
    const directory = populatedDirectory();
    addVanAndJobSite(directory);
    expect(directory.findByCode(createLocationCode("BLD-1"))).toMatchObject({
      nodeKind: "Building",
    });
    expect(directory.findByCode(createLocationCode("VAN-1"))).toMatchObject({
      operationalKind: "Van",
    });
    expect(directory.findByCode(createLocationCode("JOB-SITE-1"))).toMatchObject({
      operationalKind: "VirtualJobSite",
    });
    expect(directory.findByCode(createLocationCode("UNKNOWN"))).toBeUndefined();
  });
});

describe("mobile and virtual snapshot validation", () => {
  it("round-trips valid records and rejects duplicate Jobs and cross-Branch ownership", () => {
    const directory = populatedDirectory();
    addVanAndJobSite(directory);
    expect(LocationDirectory.rehydrate(directory.snapshot()).snapshot()).toEqual(
      directory.snapshot(),
    );

    const duplicateJob = directory.snapshot();
    const original = duplicateJob.virtualJobSites[0]!;
    expectDomainCode(
      () =>
        LocationDirectory.rehydrate({
          ...duplicateJob,
          virtualJobSites: [
            ...duplicateJob.virtualJobSites,
            {
              ...original,
              id: locationId(90),
              code: createLocationCode("JOB-DUP"),
            },
          ],
          usedCodes: [...duplicateJob.usedCodes, createLocationCode("JOB-DUP")],
        }),
      "DuplicateEntity",
    );
    expectDomainCode(
      () =>
        LocationDirectory.rehydrate({
          ...duplicateJob,
          vans: duplicateJob.vans.map((van) => ({
            ...van,
            branchId: locationId(999),
          })),
        }),
      "CrossBranchParent",
    );
  });

  it("rejects malformed van, job-site, and globally colliding records", () => {
    const directory = populatedDirectory();
    addVanAndJobSite(directory);
    const snapshot = directory.snapshot();
    const variants: readonly LocationDirectorySnapshot[] = [
      {
        ...snapshot,
        vans: snapshot.vans.map((van) => ({
          ...van,
          assignedEngineerIds: [],
        })),
      },
      {
        ...snapshot,
        virtualJobSites: snapshot.virtualJobSites.map((site) => ({
          ...site,
          status: "bad" as "Active",
        })),
      },
      {
        ...snapshot,
        vans: snapshot.vans.map((van) => ({
          ...van,
          code: createLocationCode("BLD-1"),
        })),
      },
      {
        ...snapshot,
        virtualJobSites: snapshot.virtualJobSites.map((site) => ({
          ...site,
          id: buildingOneId,
        })),
      },
    ];
    for (const variant of variants) {
      expect(() => LocationDirectory.rehydrate(variant)).toThrow(LocationDomainError);
    }
  });
});

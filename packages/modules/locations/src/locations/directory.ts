import { failLocation, LocationDomainError } from "./errors.js";
import {
  createEngineerId,
  createJobId,
  createLocationCode,
  createLocationId,
  createLocationName,
  type EngineerId,
  type JobId,
  type LocationCode,
  type LocationId,
  type LocationName,
} from "./value-objects.js";

export const hierarchyNodeKinds = [
  "Branch",
  "Building",
  "Area",
  "Aisle",
  "Shelf",
  "Bin",
  "CustomSection",
] as const;
export type HierarchyNodeKind = (typeof hierarchyNodeKinds)[number];

export const operationalLocationKinds = [
  "Container",
  "Storage",
  "Quarantine",
  "Repair",
  "Transit",
  "Van",
  "VirtualJobSite",
] as const;
export type OperationalLocationKind = (typeof operationalLocationKinds)[number];

export type HierarchyOperationalKind = Exclude<OperationalLocationKind, "Van" | "VirtualJobSite">;

export type PhysicalLocationStatus = "Active" | "Archived";
export type JobSiteLocationStatus = "Active" | "Inactive";

export interface HierarchyLocationNode {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly nodeKind: HierarchyNodeKind;
  readonly operationalKind: HierarchyOperationalKind;
  readonly parentId?: LocationId;
  readonly branchId: LocationId;
  readonly buildingId?: LocationId;
  readonly status: PhysicalLocationStatus;
  readonly generalFulfilmentEnabled: boolean;
}

export interface VanLocation {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly operationalKind: "Van";
  readonly branchId: LocationId;
  readonly status: PhysicalLocationStatus;
  readonly assignedEngineerIds: readonly EngineerId[];
  readonly primaryEngineerId: EngineerId;
}

export interface VirtualJobSiteLocation {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly operationalKind: "VirtualJobSite";
  readonly branchId: LocationId;
  readonly jobId: JobId;
  readonly status: JobSiteLocationStatus;
}

export type LocationRecord = HierarchyLocationNode | VanLocation | VirtualJobSiteLocation;

export interface CreateBranch {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
}

export interface AddHierarchyNode {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly nodeKind: Exclude<HierarchyNodeKind, "Branch">;
  readonly operationalKind: HierarchyOperationalKind;
  readonly parentId: LocationId;
  readonly generalFulfilmentEnabled?: boolean;
}

export interface LocationRetirementFacts {
  readonly occupied: boolean;
  readonly historicallyReferenced: boolean;
}

export type LocationRetirementOutcome = "Archived" | "Removed";

export type VanAssignmentActorRole = "Engineer" | "Office" | "Admin";

export interface VanAssignmentAuthorization {
  readonly actorRole: VanAssignmentActorRole;
  readonly hasManageVanAssignmentsPermission: boolean;
}

export interface EngineerAssignmentFact {
  readonly engineerId: EngineerId;
  readonly role: "Engineer" | "Office" | "Admin";
  readonly active: boolean;
}

export interface AddVan {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly assignments: readonly EngineerAssignmentFact[];
  readonly primaryEngineerId: EngineerId;
}

export interface ReplaceVanAssignments {
  readonly assignments: readonly EngineerAssignmentFact[];
  readonly primaryEngineerId: EngineerId;
}

export interface AddVirtualJobSite {
  readonly id: LocationId;
  readonly code: LocationCode;
  readonly name: LocationName;
  readonly jobId: JobId;
}

export interface JobSiteDeactivationFacts {
  readonly jobStatus:
    | "Draft"
    | "Active"
    | "OnHold"
    | "CompletionRequested"
    | "CancellationRequested"
    | "ReconciliationRequired"
    | "Completed"
    | "Cancelled";
  readonly empty: boolean;
}

export interface LocationDirectorySnapshot {
  readonly hierarchyNodes: readonly HierarchyLocationNode[];
  readonly vans: readonly VanLocation[];
  readonly virtualJobSites: readonly VirtualJobSiteLocation[];
  /**
   * Includes current and retired codes. Codes are intentionally never released.
   */
  readonly usedCodes: readonly LocationCode[];
}

const copyNode = (node: HierarchyLocationNode): HierarchyLocationNode => ({ ...node });
const copyVan = (van: VanLocation): VanLocation => ({
  ...van,
  assignedEngineerIds: [...van.assignedEngineerIds],
});
const copyJobSite = (jobSite: VirtualJobSiteLocation): VirtualJobSiteLocation => ({
  ...jobSite,
});

const isHierarchyNodeKind = (value: string): value is HierarchyNodeKind =>
  (hierarchyNodeKinds as readonly string[]).includes(value);

const isHierarchyOperationalKind = (value: string): value is HierarchyOperationalKind =>
  (
    operationalLocationKinds.filter(
      (kind) => kind !== "Van" && kind !== "VirtualJobSite",
    ) as readonly string[]
  ).includes(value);

const isPhysicalLocationStatus = (value: string): value is PhysicalLocationStatus =>
  value === "Active" || value === "Archived";

const isJobSiteLocationStatus = (value: string): value is JobSiteLocationStatus =>
  value === "Active" || value === "Inactive";

const isVanKind = (value: string): value is "Van" => value === "Van";

const isVirtualJobSiteKind = (value: string): value is "VirtualJobSite" =>
  value === "VirtualJobSite";

const ensureCanonicalNode = (node: HierarchyLocationNode): void => {
  try {
    if (
      createLocationId(node.id) !== node.id ||
      createLocationCode(node.code) !== node.code ||
      createLocationName(node.name) !== node.name ||
      !isHierarchyNodeKind(node.nodeKind) ||
      !isHierarchyOperationalKind(node.operationalKind) ||
      createLocationId(node.branchId) !== node.branchId ||
      (node.parentId !== undefined && createLocationId(node.parentId) !== node.parentId) ||
      (node.buildingId !== undefined && createLocationId(node.buildingId) !== node.buildingId) ||
      !isPhysicalLocationStatus(node.status) ||
      typeof node.generalFulfilmentEnabled !== "boolean"
    ) {
      failLocation("InvalidHierarchy", "Hierarchy contains a malformed location node.");
    }
  } catch (error) {
    if (error instanceof LocationDomainError) {
      throw error;
    }
    failLocation("InvalidHierarchy", "Hierarchy contains a malformed location node.");
  }
};

const ensureCanonicalVan = (van: VanLocation): void => {
  try {
    if (
      createLocationId(van.id) !== van.id ||
      createLocationCode(van.code) !== van.code ||
      createLocationName(van.name) !== van.name ||
      createLocationId(van.branchId) !== van.branchId ||
      !isVanKind(van.operationalKind) ||
      !isPhysicalLocationStatus(van.status) ||
      createEngineerId(van.primaryEngineerId) !== van.primaryEngineerId
    ) {
      failLocation("InvalidHierarchy", "Location directory contains a malformed van.");
    }
    normalizeEngineerIds(
      van.assignedEngineerIds.map((engineerId) => ({
        engineerId,
        role: "Engineer" as const,
        active: true,
      })),
      van.primaryEngineerId,
    );
  } catch (error) {
    if (error instanceof LocationDomainError) {
      throw error;
    }
    failLocation("InvalidHierarchy", "Location directory contains a malformed van.");
  }
};

const ensureCanonicalJobSite = (jobSite: VirtualJobSiteLocation): void => {
  try {
    if (
      createLocationId(jobSite.id) !== jobSite.id ||
      createLocationCode(jobSite.code) !== jobSite.code ||
      createLocationName(jobSite.name) !== jobSite.name ||
      createLocationId(jobSite.branchId) !== jobSite.branchId ||
      createJobId(jobSite.jobId) !== jobSite.jobId ||
      !isVirtualJobSiteKind(jobSite.operationalKind) ||
      !isJobSiteLocationStatus(jobSite.status)
    ) {
      failLocation("InvalidHierarchy", "Location directory contains a malformed job site.");
    }
  } catch (error) {
    if (error instanceof LocationDomainError) {
      throw error;
    }
    failLocation("InvalidHierarchy", "Location directory contains a malformed job site.");
  }
};

const assertAssignmentAuthorization = (authorization: VanAssignmentAuthorization): void => {
  if (
    authorization.hasManageVanAssignmentsPermission !== true ||
    (authorization.actorRole !== "Office" && authorization.actorRole !== "Admin")
  ) {
    failLocation(
      "PermissionDenied",
      "Van assignments require an explicitly permitted Office or Admin actor.",
    );
  }
};

const normalizeEngineerIds = (
  assignments: readonly EngineerAssignmentFact[],
  primaryEngineerId: EngineerId,
): readonly EngineerId[] => {
  if (assignments.length < 1) {
    failLocation("InvalidAssignment", "A van must remain assigned to at least one Engineer.");
  }
  const engineerIds = new Set<EngineerId>();
  for (const assignment of assignments) {
    if (
      createEngineerId(assignment.engineerId) !== assignment.engineerId ||
      assignment.role !== "Engineer" ||
      assignment.active !== true
    ) {
      failLocation("InvalidAssignment", "Every van assignment must identify an active Engineer.");
    }
    if (engineerIds.has(assignment.engineerId)) {
      failLocation("InvalidAssignment", "Van Engineer assignments must be unique.");
    }
    engineerIds.add(assignment.engineerId);
  }
  if (!engineerIds.has(primaryEngineerId)) {
    failLocation(
      "InvalidAssignment",
      "The primary Engineer must be included in the van assignment set.",
    );
  }
  return [...engineerIds].sort();
};

const sameIds = (left: readonly EngineerId[], right: readonly EngineerId[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export class LocationDirectory {
  readonly #nodes: Map<LocationId, HierarchyLocationNode>;
  readonly #vans: Map<LocationId, VanLocation>;
  readonly #jobSites: Map<LocationId, VirtualJobSiteLocation>;
  readonly #jobSiteByJob: Map<JobId, LocationId>;
  readonly #usedCodes: Set<LocationCode>;
  readonly #branchId: LocationId;

  private constructor(snapshot: LocationDirectorySnapshot) {
    this.#nodes = new Map(snapshot.hierarchyNodes.map((node) => [node.id, copyNode(node)]));
    this.#vans = new Map(snapshot.vans.map((van) => [van.id, copyVan(van)]));
    this.#jobSites = new Map(
      snapshot.virtualJobSites.map((jobSite) => [jobSite.id, copyJobSite(jobSite)]),
    );
    this.#jobSiteByJob = new Map(
      snapshot.virtualJobSites.map((jobSite) => [jobSite.jobId, jobSite.id]),
    );
    this.#usedCodes = new Set(snapshot.usedCodes);
    this.#branchId = this.assertValidSnapshot(snapshot);
  }

  public static create(branch: CreateBranch): LocationDirectory {
    const root: HierarchyLocationNode = {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      nodeKind: "Branch",
      operationalKind: "Container",
      branchId: branch.id,
      status: "Active",
      generalFulfilmentEnabled: false,
    };
    return new LocationDirectory({
      hierarchyNodes: [root],
      vans: [],
      virtualJobSites: [],
      usedCodes: [root.code],
    });
  }

  public static rehydrate(snapshot: LocationDirectorySnapshot): LocationDirectory {
    return new LocationDirectory(snapshot);
  }

  public get branchId(): LocationId {
    return this.#branchId;
  }

  public snapshot(): LocationDirectorySnapshot {
    return {
      hierarchyNodes: [...this.#nodes.values()].map(copyNode),
      vans: [...this.#vans.values()].map(copyVan),
      virtualJobSites: [...this.#jobSites.values()].map(copyJobSite),
      usedCodes: [...this.#usedCodes].sort(),
    };
  }

  public getHierarchyNode(id: LocationId): HierarchyLocationNode | undefined {
    const node = this.#nodes.get(id);
    return node === undefined ? undefined : copyNode(node);
  }

  public listHierarchyNodes(): readonly HierarchyLocationNode[] {
    return [...this.#nodes.values()].map(copyNode);
  }

  public getVan(id: LocationId): VanLocation | undefined {
    const van = this.#vans.get(id);
    return van === undefined ? undefined : copyVan(van);
  }

  public getJobSiteForJob(jobId: JobId): VirtualJobSiteLocation | undefined {
    const locationId = this.#jobSiteByJob.get(jobId);
    if (locationId === undefined) {
      return undefined;
    }
    return copyJobSite(this.#jobSites.get(locationId)!);
  }

  public findByCode(code: LocationCode): LocationRecord | undefined {
    for (const record of [
      ...this.#nodes.values(),
      ...this.#vans.values(),
      ...this.#jobSites.values(),
    ]) {
      if (record.code === code) {
        if (record.operationalKind === "Van") {
          return copyVan(record);
        }
        if (record.operationalKind === "VirtualJobSite") {
          return copyJobSite(record);
        }
        return copyNode(record);
      }
    }
    return undefined;
  }

  public addHierarchyNode(input: AddHierarchyNode): HierarchyLocationNode {
    this.assertUnusedIdentity(input.id, input.code);
    const nodeKind: string = input.nodeKind;
    if (
      createLocationName(input.name) !== input.name ||
      nodeKind === "Branch" ||
      !isHierarchyNodeKind(nodeKind) ||
      !isHierarchyOperationalKind(input.operationalKind)
    ) {
      failLocation("IllegalNodeKind", "New hierarchy node metadata is invalid.");
    }
    const parent = this.requiredActiveNode(input.parentId);
    if (input.nodeKind === "Building") {
      if (parent.nodeKind !== "Branch" || input.operationalKind !== "Container") {
        failLocation(
          "InvalidParent",
          "A Building must be an operational Container directly owned by the Branch.",
        );
      }
    } else if (
      parent.nodeKind === "Branch" ||
      parent.nodeKind === "Bin" ||
      input.operationalKind === "Container"
    ) {
      failLocation(
        "InvalidParent",
        "A spatial location must be inside a Building and a Bin cannot contain children.",
      );
    }
    if (input.generalFulfilmentEnabled === true && input.operationalKind !== "Storage") {
      failLocation(
        "InvalidOperation",
        "Only an active Storage location can be enabled for general fulfilment.",
      );
    }

    const buildingId = input.nodeKind === "Building" ? input.id : (parent.buildingId ?? parent.id);
    const node: HierarchyLocationNode = {
      id: input.id,
      code: input.code,
      name: input.name,
      nodeKind: input.nodeKind,
      operationalKind: input.operationalKind,
      parentId: parent.id,
      branchId: this.#branchId,
      buildingId,
      status: "Active",
      generalFulfilmentEnabled: input.generalFulfilmentEnabled ?? false,
    };
    ensureCanonicalNode(node);
    this.#nodes.set(node.id, node);
    this.#usedCodes.add(node.code);
    return copyNode(node);
  }

  public renameLocation(id: LocationId, name: LocationName): LocationRecord {
    if (createLocationName(name) !== name) {
      failLocation("InvalidOperation", "Location name must be canonical.");
    }
    const node = this.#nodes.get(id);
    if (node !== undefined) {
      this.assertActive(node.status);
      const changed = { ...node, name };
      this.#nodes.set(id, changed);
      return copyNode(changed);
    }
    const van = this.#vans.get(id);
    if (van !== undefined) {
      this.assertActive(van.status);
      const changed = { ...van, name };
      this.#vans.set(id, changed);
      return copyVan(changed);
    }
    const jobSite = this.#jobSites.get(id);
    if (jobSite !== undefined) {
      if (jobSite.status !== "Active") {
        failLocation("ArchivedEntity", "An inactive job-site location cannot be renamed.");
      }
      const changed = { ...jobSite, name };
      this.#jobSites.set(id, changed);
      return copyJobSite(changed);
    }
    failLocation("MissingEntity", "Location does not exist.");
  }

  public moveHierarchyNode(id: LocationId, newParentId: LocationId): HierarchyLocationNode {
    const node = this.requiredActiveNode(id);
    if (node.nodeKind === "Branch" || node.nodeKind === "Building") {
      failLocation("InvalidOperation", "Branch and Building ownership cannot be moved.");
    }
    const parent = this.requiredActiveNode(newParentId);
    if (parent.nodeKind === "Branch" || parent.nodeKind === "Bin") {
      failLocation("InvalidParent", "The selected parent cannot contain this location.");
    }
    if (node.id === parent.id || this.isDescendant(parent.id, node.id)) {
      failLocation("Cycle", "Moving this location would create a hierarchy cycle.");
    }
    if (node.branchId !== parent.branchId) {
      failLocation("CrossBranchParent", "Locations cannot be parented across branches.");
    }
    if (node.buildingId !== (parent.buildingId ?? parent.id)) {
      failLocation(
        "CrossBuildingParent",
        "A location cannot move between Buildings without creating a new location identity.",
      );
    }
    if (node.parentId === parent.id) {
      failLocation("NoChange", "The location already has that parent.");
    }
    const changed = { ...node, parentId: parent.id };
    this.#nodes.set(id, changed);
    return copyNode(changed);
  }

  public setGeneralFulfilment(id: LocationId, enabled: boolean): HierarchyLocationNode {
    if (typeof enabled !== "boolean") {
      failLocation("InvalidOperation", "General fulfilment requires an explicit boolean.");
    }
    const node = this.requiredActiveNode(id);
    if (node.operationalKind !== "Storage") {
      failLocation(
        "InvalidOperation",
        "General fulfilment can only be configured for a Storage location.",
      );
    }
    if (node.generalFulfilmentEnabled === enabled) {
      failLocation("NoChange", "General fulfilment is already configured to that value.");
    }
    const changed = { ...node, generalFulfilmentEnabled: enabled };
    this.#nodes.set(id, changed);
    return copyNode(changed);
  }

  public retireHierarchyNode(
    id: LocationId,
    facts: LocationRetirementFacts,
  ): LocationRetirementOutcome {
    if (typeof facts.occupied !== "boolean" || typeof facts.historicallyReferenced !== "boolean") {
      failLocation("InvalidOperation", "Location retirement facts must be explicit booleans.");
    }
    const node = this.requiredActiveNode(id);
    if (node.nodeKind === "Branch") {
      failLocation("InvalidOperation", "The deployment Branch cannot be retired.");
    }
    const children = [...this.#nodes.values()].filter((candidate) => candidate.parentId === id);
    if (children.some((child) => child.status === "Active")) {
      failLocation("Orphan", "Archive or move every active child before retiring its parent.");
    }

    if (facts.occupied || facts.historicallyReferenced || children.length > 0) {
      this.#nodes.set(id, {
        ...node,
        status: "Archived",
        generalFulfilmentEnabled: false,
      });
      return "Archived";
    }
    this.#nodes.delete(id);
    return "Removed";
  }

  public addVan(input: AddVan, authorization: VanAssignmentAuthorization): VanLocation {
    assertAssignmentAuthorization(authorization);
    this.assertUnusedIdentity(input.id, input.code);
    const assignedEngineerIds = normalizeEngineerIds(input.assignments, input.primaryEngineerId);
    const van: VanLocation = {
      id: input.id,
      code: input.code,
      name: input.name,
      operationalKind: "Van",
      branchId: this.#branchId,
      status: "Active",
      assignedEngineerIds,
      primaryEngineerId: input.primaryEngineerId,
    };
    ensureCanonicalVan(van);
    this.#vans.set(van.id, van);
    this.#usedCodes.add(van.code);
    return copyVan(van);
  }

  public replaceVanAssignments(
    vanId: LocationId,
    input: ReplaceVanAssignments,
    authorization: VanAssignmentAuthorization,
  ): VanLocation {
    assertAssignmentAuthorization(authorization);
    const van = this.#vans.get(vanId);
    if (van === undefined) {
      failLocation("MissingEntity", "Van does not exist.");
    }
    this.assertActive(van.status);
    const assignedEngineerIds = normalizeEngineerIds(input.assignments, input.primaryEngineerId);
    if (
      van.primaryEngineerId === input.primaryEngineerId &&
      sameIds(van.assignedEngineerIds, assignedEngineerIds)
    ) {
      failLocation("NoChange", "Van assignments are unchanged.");
    }
    const changed: VanLocation = {
      ...van,
      assignedEngineerIds,
      primaryEngineerId: input.primaryEngineerId,
    };
    this.#vans.set(vanId, changed);
    return copyVan(changed);
  }

  public archiveVan(vanId: LocationId): VanLocation {
    const van = this.#vans.get(vanId);
    if (van === undefined) {
      failLocation("MissingEntity", "Van does not exist.");
    }
    this.assertActive(van.status);
    const changed: VanLocation = { ...van, status: "Archived" };
    this.#vans.set(vanId, changed);
    return copyVan(changed);
  }

  public addVirtualJobSite(input: AddVirtualJobSite): VirtualJobSiteLocation {
    this.assertUnusedIdentity(input.id, input.code);
    if (this.#jobSiteByJob.has(input.jobId)) {
      failLocation(
        "DuplicateEntity",
        "A Job can have only one virtual job-site location, including inactive history.",
      );
    }
    const jobSite: VirtualJobSiteLocation = {
      id: input.id,
      code: input.code,
      name: input.name,
      operationalKind: "VirtualJobSite",
      branchId: this.#branchId,
      jobId: input.jobId,
      status: "Active",
    };
    ensureCanonicalJobSite(jobSite);
    this.#jobSites.set(jobSite.id, jobSite);
    this.#jobSiteByJob.set(jobSite.jobId, jobSite.id);
    this.#usedCodes.add(jobSite.code);
    return copyJobSite(jobSite);
  }

  public deactivateVirtualJobSite(
    jobId: JobId,
    facts: JobSiteDeactivationFacts,
  ): VirtualJobSiteLocation {
    const locationId = this.#jobSiteByJob.get(jobId);
    const jobSite = locationId === undefined ? undefined : this.#jobSites.get(locationId);
    if (jobSite === undefined) {
      failLocation("MissingEntity", "Job-site location does not exist.");
    }
    if (jobSite.status !== "Active") {
      failLocation("ArchivedEntity", "Job-site location is already inactive.");
    }
    if (facts.jobStatus !== "Completed" && facts.jobStatus !== "Cancelled") {
      failLocation(
        "InvalidOperation",
        "A job-site location remains active until its Job is Completed or Cancelled.",
      );
    }
    if (facts.empty !== true) {
      failLocation(
        "LocationNotEmpty",
        "A closed Job's site remains active until every stock holding is resolved.",
      );
    }
    const changed: VirtualJobSiteLocation = { ...jobSite, status: "Inactive" };
    this.#jobSites.set(jobSite.id, changed);
    return copyJobSite(changed);
  }

  private assertValidSnapshot(snapshot: LocationDirectorySnapshot): LocationId {
    if (
      snapshot.hierarchyNodes.length < 1 ||
      snapshot.usedCodes.length !== new Set(snapshot.usedCodes).size
    ) {
      failLocation("InvalidHierarchy", "Location directory snapshot is incomplete or ambiguous.");
    }
    for (const node of snapshot.hierarchyNodes) {
      ensureCanonicalNode(node);
    }
    for (const van of snapshot.vans) {
      ensureCanonicalVan(van);
    }
    for (const jobSite of snapshot.virtualJobSites) {
      ensureCanonicalJobSite(jobSite);
    }

    const allRecords: readonly LocationRecord[] = [
      ...snapshot.hierarchyNodes,
      ...snapshot.vans,
      ...snapshot.virtualJobSites,
    ];
    if (new Set(allRecords.map((record) => record.id)).size !== allRecords.length) {
      failLocation("DuplicateEntity", "Every location identity must be globally unique.");
    }
    if (new Set(allRecords.map((record) => record.code)).size !== allRecords.length) {
      failLocation("CodeAlreadyUsed", "Every current location code must be globally unique.");
    }
    const usedCodes = new Set(snapshot.usedCodes);
    for (const code of usedCodes) {
      try {
        if (createLocationCode(code) !== code) {
          failLocation(
            "InvalidHierarchy",
            "The used-code ledger must contain only canonical location codes.",
          );
        }
      } catch (error) {
        if (error instanceof LocationDomainError) {
          throw error;
        }
        failLocation(
          "InvalidHierarchy",
          "The used-code ledger must contain only canonical location codes.",
        );
      }
    }
    if (allRecords.some((record) => !usedCodes.has(record.code))) {
      failLocation(
        "InvalidHierarchy",
        "The used-code ledger must retain every current location code.",
      );
    }

    const branches = snapshot.hierarchyNodes.filter((node) => node.nodeKind === "Branch");
    if (branches.length !== 1) {
      failLocation("InvalidHierarchy", "A deployment must contain exactly one Branch.");
    }
    const branch = branches[0]!;
    if (
      branch.parentId !== undefined ||
      branch.buildingId !== undefined ||
      branch.branchId !== branch.id ||
      branch.operationalKind !== "Container" ||
      branch.status !== "Active" ||
      branch.generalFulfilmentEnabled
    ) {
      failLocation("InvalidHierarchy", "The Branch root has illegal ownership or state.");
    }

    const nodeById = new Map(snapshot.hierarchyNodes.map((node) => [node.id, node]));
    for (const node of snapshot.hierarchyNodes) {
      if (node.nodeKind === "Branch") {
        continue;
      }
      if (node.branchId !== branch.id) {
        failLocation("CrossBranchParent", "Every hierarchy node must belong to the one Branch.");
      }
      const parent = node.parentId === undefined ? undefined : nodeById.get(node.parentId);
      if (parent === undefined) {
        failLocation("Orphan", "Every non-Branch hierarchy node must have an existing parent.");
      }
      if (node.status === "Active" && parent.status === "Archived") {
        failLocation("Orphan", "An active hierarchy node cannot have an archived parent.");
      }
      if (node.nodeKind === "Building") {
        if (
          parent.id !== branch.id ||
          node.buildingId !== node.id ||
          node.operationalKind !== "Container" ||
          node.generalFulfilmentEnabled
        ) {
          failLocation(
            "IllegalBuildingOwnership",
            "A Building must be a Branch-owned Container with its own Building identity.",
          );
        }
        continue;
      }
      if (
        parent.nodeKind === "Branch" ||
        parent.nodeKind === "Bin" ||
        node.operationalKind === "Container"
      ) {
        failLocation("InvalidParent", "A spatial hierarchy node has an illegal parent or kind.");
      }
      const derivedBuildingId = this.deriveBuildingId(node, nodeById);
      if (node.buildingId !== derivedBuildingId) {
        failLocation(
          "IllegalBuildingOwnership",
          "A hierarchy node's Building ownership does not match its ancestry.",
        );
      }
      if (node.generalFulfilmentEnabled && node.operationalKind !== "Storage") {
        failLocation(
          "InvalidHierarchy",
          "Only Storage hierarchy nodes can enable general fulfilment.",
        );
      }
    }

    const jobIds = new Set<JobId>();
    for (const record of [...snapshot.vans, ...snapshot.virtualJobSites]) {
      if (record.branchId !== branch.id) {
        failLocation("CrossBranchParent", "Every location must belong to the one Branch.");
      }
      if (record.operationalKind === "VirtualJobSite") {
        if (jobIds.has(record.jobId)) {
          failLocation("DuplicateEntity", "A Job can have only one virtual job-site location.");
        }
        jobIds.add(record.jobId);
      }
    }
    return branch.id;
  }

  private deriveBuildingId(
    node: HierarchyLocationNode,
    nodeById: ReadonlyMap<LocationId, HierarchyLocationNode>,
  ): LocationId {
    const visited = new Set<LocationId>([node.id]);
    let parentId = node.parentId;
    while (parentId !== undefined) {
      if (visited.has(parentId)) {
        failLocation("Cycle", "Hierarchy ancestry contains a cycle.");
      }
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      if (parent === undefined) {
        failLocation("Orphan", "Hierarchy ancestry contains an orphan.");
      }
      if (parent.nodeKind === "Building") {
        return parent.id;
      }
      if (parent.nodeKind === "Branch") {
        failLocation("IllegalBuildingOwnership", "A spatial node must belong to a Building.");
      }
      parentId = parent.parentId;
    }
    failLocation("Orphan", "Hierarchy ancestry does not reach a Building.");
  }

  private assertUnusedIdentity(id: LocationId, code: LocationCode): void {
    if (this.#nodes.has(id) || this.#vans.has(id) || this.#jobSites.has(id)) {
      failLocation("DuplicateEntity", "Location identity is already in use.");
    }
    if (this.#usedCodes.has(code)) {
      failLocation("CodeAlreadyUsed", "Location codes are stable and can never be reused.");
    }
  }

  private requiredActiveNode(id: LocationId): HierarchyLocationNode {
    const node = this.#nodes.get(id);
    if (node === undefined) {
      failLocation("MissingEntity", "Hierarchy node does not exist.");
    }
    this.assertActive(node.status);
    return node;
  }

  private assertActive(status: PhysicalLocationStatus): void {
    if (status !== "Active") {
      failLocation("ArchivedEntity", "Archived locations cannot be mutated or reused.");
    }
  }

  private isDescendant(candidateId: LocationId, ancestorId: LocationId): boolean {
    let cursor = this.#nodes.get(candidateId);
    const visited = new Set<LocationId>();
    while (cursor?.parentId !== undefined) {
      if (visited.has(cursor.id)) {
        failLocation("Cycle", "Hierarchy contains a pre-existing cycle.");
      }
      visited.add(cursor.id);
      if (cursor.parentId === ancestorId) {
        return true;
      }
      cursor = this.#nodes.get(cursor.parentId);
    }
    return false;
  }
}

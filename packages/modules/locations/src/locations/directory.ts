import { failLocation, LocationDomainError } from "./errors.js";
import {
  createLocationCode,
  createLocationName,
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
export interface LocationDirectorySnapshot {
  readonly hierarchyNodes: readonly HierarchyLocationNode[];
  readonly vans: readonly unknown[];
  readonly virtualJobSites: readonly unknown[];
  readonly usedCodes: readonly LocationCode[];
}
export interface LocationRetirementFacts {
  readonly occupied: boolean;
  readonly historicallyReferenced: boolean;
}
export type LocationRetirementOutcome = "Archived" | "Removed";

const copyNode = (node: HierarchyLocationNode): HierarchyLocationNode => ({ ...node });
const validNodeKind = (value: string): value is HierarchyNodeKind =>
  (hierarchyNodeKinds as readonly string[]).includes(value);
const validOperational = (value: string): value is HierarchyOperationalKind =>
  ["Container", "Storage", "Quarantine", "Repair", "Transit"].includes(value);

export class LocationDirectory {
  readonly #nodes: Map<LocationId, HierarchyLocationNode>;
  readonly #usedCodes: Set<LocationCode>;
  readonly #branchId: LocationId;

  private constructor(snapshot: LocationDirectorySnapshot) {
    this.#nodes = new Map(snapshot.hierarchyNodes.map((node) => [node.id, copyNode(node)]));
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
      vans: [],
      virtualJobSites: [],
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
  public findByCode(code: LocationCode): HierarchyLocationNode | undefined {
    return [...this.#nodes.values()].find((node) => node.code === code);
  }

  public addHierarchyNode(input: AddHierarchyNode): HierarchyLocationNode {
    if (this.#nodes.has(input.id) || this.#usedCodes.has(input.code)) {
      failLocation(
        this.#nodes.has(input.id) ? "DuplicateEntity" : "CodeAlreadyUsed",
        "Location identity or code is already in use.",
      );
    }
    try {
      if (
        createLocationCode(input.code) !== input.code ||
        createLocationName(input.name) !== input.name ||
        !validNodeKind(input.nodeKind) ||
        !validOperational(input.operationalKind)
      ) {
        failLocation("InvalidHierarchy", "New hierarchy node metadata is invalid.");
      }
    } catch (error) {
      if (error instanceof LocationDomainError) throw error;
      failLocation("InvalidHierarchy", "New hierarchy node metadata is invalid.");
    }
    const parent = this.requiredActiveNode(input.parentId);
    if (input.nodeKind === "Building") {
      if (parent.nodeKind !== "Branch" || input.operationalKind !== "Container")
        failLocation("InvalidParent", "A Building must be directly owned by the Branch.");
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
        "Only Storage locations can be enabled for general fulfilment.",
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
    this.#nodes.set(node.id, node);
    this.#usedCodes.add(node.code);
    return copyNode(node);
  }

  public renameLocation(id: LocationId, name: LocationName): HierarchyLocationNode {
    if (createLocationName(name) !== name)
      failLocation("InvalidOperation", "Location name must be canonical.");
    const node = this.requiredNode(id);
    this.assertActive(node.status);
    const changed = { ...node, name };
    this.#nodes.set(id, changed);
    return copyNode(changed);
  }

  public moveHierarchyNode(id: LocationId, newParentId: LocationId): HierarchyLocationNode {
    const node = this.requiredActiveNode(id);
    if (node.nodeKind === "Branch" || node.nodeKind === "Building")
      failLocation("InvalidOperation", "Branch and Building ownership cannot be moved.");
    const parent = this.requiredActiveNode(newParentId);
    if (parent.nodeKind === "Branch" || parent.nodeKind === "Bin")
      failLocation("InvalidParent", "The selected parent cannot contain this location.");
    if (node.id === parent.id || this.isDescendant(parent.id, node.id))
      failLocation("Cycle", "Moving this location would create a hierarchy cycle.");
    if (node.branchId !== parent.branchId)
      failLocation("CrossBranchParent", "Locations cannot be parented across branches.");
    if (node.buildingId !== (parent.buildingId ?? parent.id))
      failLocation(
        "CrossBuildingParent",
        "A location cannot move between Buildings without a new identity.",
      );
    if (node.parentId === parent.id)
      failLocation("NoChange", "The location already has that parent.");
    const changed = { ...node, parentId: parent.id };
    this.#nodes.set(id, changed);
    return copyNode(changed);
  }

  public setGeneralFulfilment(id: LocationId, enabled: boolean): HierarchyLocationNode {
    const node = this.requiredActiveNode(id);
    if (node.operationalKind !== "Storage")
      failLocation("InvalidOperation", "Only Storage locations can use general fulfilment.");
    if (node.generalFulfilmentEnabled === enabled)
      failLocation("NoChange", "General fulfilment is already configured to that value.");
    const changed = { ...node, generalFulfilmentEnabled: enabled };
    this.#nodes.set(id, changed);
    return copyNode(changed);
  }

  public retireHierarchyNode(
    id: LocationId,
    facts: LocationRetirementFacts,
  ): LocationRetirementOutcome {
    const node = this.requiredActiveNode(id);
    if (node.nodeKind === "Branch")
      failLocation("InvalidOperation", "The deployment Branch cannot be retired.");
    const children = [...this.#nodes.values()].filter((candidate) => candidate.parentId === id);
    if (children.some((child) => child.status === "Active"))
      failLocation("Orphan", "Archive or move every active child before retiring its parent.");
    if (facts.occupied || facts.historicallyReferenced || children.length > 0) {
      this.#nodes.set(id, { ...node, status: "Archived", generalFulfilmentEnabled: false });
      return "Archived";
    }
    this.#nodes.delete(id);
    return "Removed";
  }

  private requiredNode(id: LocationId): HierarchyLocationNode {
    const node = this.#nodes.get(id);
    if (node === undefined) failLocation("MissingEntity", "Location does not exist.");
    return node;
  }
  private requiredActiveNode(id: LocationId): HierarchyLocationNode {
    const node = this.requiredNode(id);
    this.assertActive(node.status);
    return node;
  }
  private assertActive(status: PhysicalLocationStatus): void {
    if (status !== "Active")
      failLocation("ArchivedEntity", "Archived locations cannot be changed.");
  }
  private isDescendant(candidateId: LocationId, ancestorId: LocationId): boolean {
    let cursor = this.#nodes.get(candidateId);
    const seen = new Set<LocationId>();
    while (cursor?.parentId !== undefined) {
      if (seen.has(cursor.id)) failLocation("Cycle", "The hierarchy contains a cycle.");
      seen.add(cursor.id);
      if (cursor.parentId === ancestorId) return true;
      cursor = this.#nodes.get(cursor.parentId);
    }
    return false;
  }
  private assertValidSnapshot(snapshot: LocationDirectorySnapshot): LocationId {
    const branches = snapshot.hierarchyNodes.filter((node) => node.nodeKind === "Branch");
    if (branches.length !== 1 || branches[0]?.status !== "Active")
      failLocation("InvalidHierarchy", "Exactly one active Branch is required.");
    const branch = branches[0];
    const ids = new Set<LocationId>();
    const codes = new Set<LocationCode>();
    for (const node of snapshot.hierarchyNodes) {
      if (ids.has(node.id) || codes.has(node.code))
        failLocation("DuplicateEntity", "Hierarchy identities and codes must be unique.");
      ids.add(node.id);
      codes.add(node.code);
      if (
        node.branchId !== branch.id ||
        !validNodeKind(node.nodeKind) ||
        !validOperational(node.operationalKind)
      )
        failLocation("InvalidHierarchy", "Hierarchy contains a malformed node.");
      if (node.nodeKind === "Branch" && node.parentId !== undefined)
        failLocation("InvalidHierarchy", "The Branch cannot have a parent.");
      if (node.parentId !== undefined) {
        const parent = this.#nodes.get(node.parentId);
        if (parent === undefined) failLocation("Orphan", "Hierarchy contains an orphaned node.");
        if (parent.id === node.id) failLocation("Cycle", "Hierarchy cannot contain a self-cycle.");
        if (node.status === "Active" && parent.status !== "Active")
          failLocation("Orphan", "An active node cannot have an archived parent.");
        if (
          node.nodeKind === "Building" &&
          (parent.nodeKind !== "Branch" || node.operationalKind !== "Container")
        )
          failLocation(
            "InvalidParent",
            "A Building must be a Container directly owned by the Branch.",
          );
        if (
          node.nodeKind !== "Building" &&
          (parent.nodeKind === "Branch" ||
            parent.nodeKind === "Bin" ||
            node.operationalKind === "Container")
        )
          failLocation(
            "InvalidParent",
            "A spatial location must be inside a Building and a Bin cannot contain children.",
          );
      }
      if (node.generalFulfilmentEnabled && node.operationalKind !== "Storage")
        failLocation("InvalidHierarchy", "Only Storage locations can use general fulfilment.");
    }
    for (const node of snapshot.hierarchyNodes) {
      const seen = new Set<LocationId>();
      let cursor: HierarchyLocationNode | undefined = node;
      while (cursor?.parentId !== undefined) {
        if (seen.has(cursor.id)) failLocation("Cycle", "Hierarchy contains a cycle.");
        seen.add(cursor.id);
        cursor = this.#nodes.get(cursor.parentId);
      }
      if (node.nodeKind !== "Branch" && node.status === "Active" && cursor?.status !== "Active")
        failLocation("Orphan", "An active node cannot have an archived parent.");
      if (
        node.nodeKind === "Building" &&
        (node.parentId !== branch.id || node.buildingId !== node.id)
      )
        failLocation("InvalidHierarchy", "Buildings must be direct Branch children.");
      if (
        node.nodeKind !== "Branch" &&
        node.nodeKind !== "Building" &&
        node.buildingId === undefined
      )
        failLocation("InvalidHierarchy", "Spatial nodes must belong to a Building.");
    }
    return branch.id;
  }
}

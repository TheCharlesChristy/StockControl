import { roleHasCapability, type UserRole } from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

import type { McpConfiguration } from "../../src/integrations/mcp/mcp-configuration";
import {
  findToolSpec,
  mcpToolDefinitions,
  toolSpecs,
  ToolValidationError,
  type ToolSpec,
} from "../../src/integrations/mcp/mcp-tool-catalogue";
import { MCP_SCOPES } from "../../src/integrations/mcp/oauth.service";

const everything = {
  enabled: true,
  readToolsEnabled: true,
  writeToolsEnabled: true,
} as McpConfiguration;

const specFor = (name: string): ToolSpec => {
  const spec = findToolSpec(name);
  if (spec === undefined) throw new Error(`No tool named ${name}.`);
  return spec;
};

const writeExtras = { actionSummary: "why", idempotencyKey: "key-1" };
const ITEM = "0f1e2d3c-4b5a-4968-8776-655443332211";
const OTHER = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

describe("the MCP tool catalogue", () => {
  it("publishes an input and output schema for every enabled tool", () => {
    const definitions = mcpToolDefinitions(everything);

    expect(definitions).toHaveLength(toolSpecs.length);
    expect(definitions.every((definition) => definition.outputSchema.type === "object")).toBe(true);
    expect(definitions.every((definition) => definition.inputSchema.type === "object")).toBe(true);
    expect(definitions.every((definition) => definition.description.length > 20)).toBe(true);
  });

  it("names every tool once", () => {
    expect(new Set(toolSpecs.map((tool) => tool.name)).size).toBe(toolSpecs.length);
  });

  it("only asks for scopes the OAuth server can actually grant", () => {
    for (const tool of toolSpecs) {
      for (const scope of tool.scopes) {
        expect(MCP_SCOPES).toContain(scope);
      }
    }
  });

  /*
   * A read tool that a role cannot reach is dead weight in the catalogue, and a
   * write tool an Engineer could reach through a scope alone would put the
   * permission model in two places. Both are caught here rather than in review.
   */
  it("gives every tool a capability some role holds", () => {
    const roles: readonly UserRole[] = ["Engineer", "Office", "Admin"];

    for (const tool of toolSpecs) {
      expect(roles.some((role) => roleHasCapability(role, tool.capability))).toBe(true);
    }
  });

  it("hides write tools when only read tools are enabled", () => {
    const definitions = mcpToolDefinitions({ ...everything, writeToolsEnabled: false });

    expect(
      definitions.every((definition) => definition.annotations?.["readOnlyHint"] === true),
    ).toBe(true);
    expect(definitions.map((definition) => definition.name)).not.toContain("receive_stock");
  });

  it("marks the one tool that erases something as destructive", () => {
    const destructive = mcpToolDefinitions(everything).filter(
      (definition) => definition.annotations?.["destructiveHint"] === true,
    );

    expect(destructive.map((definition) => definition.name)).toEqual(["delete_location"]);
  });

  it("demands a summary and an idempotency key from every write", () => {
    for (const tool of toolSpecs.filter((candidate) => candidate.operation === "write")) {
      expect(tool.inputSchema["required"]).toEqual(
        expect.arrayContaining(["actionSummary", "idempotencyKey"]),
      );
    }
  });

  it("refuses a write with no idempotency key", () => {
    expect(() => specFor("archive_item").validate({ itemId: ITEM, actionSummary: "why" })).toThrow(
      ToolValidationError,
    );
  });

  it("accepts a counted quantity of zero, which every other quantity refuses", () => {
    const validated = specFor("adjust_stock").validate({
      itemId: ITEM,
      locationId: OTHER,
      countedQuantity: "0",
      reason: "Shelf was empty",
      ...writeExtras,
    });

    expect(validated["countedQuantity"]).toBe("0");
    expect(() =>
      specFor("receive_stock").validate({
        itemId: ITEM,
        locationId: OTHER,
        quantity: "0",
        ...writeExtras,
      }),
    ).toThrow(ToolValidationError);
  });

  /* Clearing a barcode is a null, not an omission: the two mean different things. */
  it("keeps a null apart from an absent field when editing an item", () => {
    const cleared = specFor("update_item").validate({
      itemId: ITEM,
      barcode: null,
      ...writeExtras,
    });

    expect(cleared["barcode"]).toBeNull();
    expect(cleared).not.toHaveProperty("partNumber");
  });

  it("refuses a role that is not one of the three", () => {
    expect(() =>
      specFor("update_user").validate({ userId: ITEM, role: "Superuser", ...writeExtras }),
    ).toThrow(ToolValidationError);
    expect(
      specFor("update_user").validate({ userId: ITEM, role: "Office", ...writeExtras })["role"],
    ).toBe("Office");
  });

  it("refuses an identifier that is not a UUID", () => {
    expect(() => specFor("get_item").validate({ itemId: "ITEM-1" })).toThrow(ToolValidationError);
  });

  it("bounds every page it will serve", () => {
    expect(() => specFor("search_items").validate({ limit: 1000 })).toThrow(ToolValidationError);
    expect(specFor("search_items").validate({})).toEqual({
      search: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("records malformed arguments for the audit trail without validating them", () => {
    expect(specFor("search_items").project({ search: 42, limit: "many" })).toEqual({
      search: undefined,
      limit: "many",
      offset: undefined,
    });
  });
});

import { createChecksummedMigration, type CanonicalMigrationDefinition } from "./integrity";

/**
 * The expanded MCP tool catalogue reaches beyond stock: a tool can now archive
 * a location, archive a map or change a user, and each of those effects needs
 * to be linkable from its call record for the activity screen to reconstruct
 * what happened.
 */
export const mcpEffectLinkTypesMigrationDefinition = Object.freeze({
  name: "0012_mcp_effect_link_types",
  version: 12,
  upStatements: Object.freeze([
    "alter table stockcontrol.mcp_effect_links drop constraint if exists mcp_effect_links_effect_type",
    "alter table stockcontrol.mcp_effect_links add constraint mcp_effect_links_effect_type check (effect_type in ('transaction', 'reservation', 'request', 'job', 'item', 'location', 'map', 'user', 'photo'))",
  ]),
  downStatements: Object.freeze([
    "delete from stockcontrol.mcp_effect_links where effect_type in ('map', 'user', 'photo')",
    "alter table stockcontrol.mcp_effect_links drop constraint if exists mcp_effect_links_effect_type",
    "alter table stockcontrol.mcp_effect_links add constraint mcp_effect_links_effect_type check (effect_type in ('transaction', 'reservation', 'request', 'job', 'item', 'location'))",
  ]),
} satisfies CanonicalMigrationDefinition);

const checkedMigration = createChecksummedMigration(mcpEffectLinkTypesMigrationDefinition);

export const mcpEffectLinkTypesMigration = checkedMigration.migration;
export const mcpEffectLinkTypesMigrationIntegrity = checkedMigration.descriptor;

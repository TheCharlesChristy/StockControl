import type { SxProps, Theme } from "@mui/material";

/**
 * Style objects and palette values hoisted out of render.
 *
 * MUI's `sx` prop is serialised by Emotion every time it receives a fresh
 * object, which is why the old page paid for the whole location list's styles
 * on every pointer move. Module constants are serialised once.
 */

export const mapBorder = "#D9E0E9";
export const panelBorder = "#E2E7EE";
export const canvasBackground = "#F8FAFC";
export const gridLine = "#DFE5EE";
export const selectionStroke = "#071B3A";
export const shapeStroke = "#FFFFFF";

/*
 * Only the four states the server can actually produce. It emits Available,
 * LowStock, OutOfStock and Archived and nothing else, so a fifth swatch here
 * described a colour no shape ever wears — and "Full" sitting beside
 * "Available" implied a distinction between them that does not exist.
 */
export const statusLegend = [
  { colour: "#2E7D32", label: "Available" },
  { colour: "#ED6C02", label: "Low stock" },
  { colour: "#D32F2F", label: "Out of stock" },
  { colour: "#757575", label: "Archived" },
] as const;

export const floatingPanel: SxProps<Theme> = {
  position: "absolute",
  px: 1.25,
  py: 0.75,
  border: "1px solid #D8DEE8",
  borderRadius: 1,
  bgcolor: "rgba(255,255,255,0.92)",
  boxShadow: "0 4px 14px rgba(19,36,65,0.08)",
};

export const toolbarSx: SxProps<Theme> = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1,
  minHeight: 48,
  px: 1.25,
  py: 0.75,
  borderBottom: `1px solid ${mapBorder}`,
  bgcolor: "#FFFFFF",
  flexWrap: "wrap",
};

export const toolbarGroupSx: SxProps<Theme> = {
  display: "flex",
  alignItems: "center",
  gap: 0.25,
  pr: 1,
  mr: 0.5,
  borderRight: `1px solid ${panelBorder}`,
};

export const toggleGroupSx: SxProps<Theme> = { height: 34 };

export const canvasSurfaceSx: SxProps<Theme> = {
  /*
   * Absolute, not just relative: an `<svg>` whose parent has no resolved height
   * falls back to the SVG default of 150px, which collapses the whole editor.
   */
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  bgcolor: canvasBackground,
};

export const emptyCanvasSx: SxProps<Theme> = {
  position: "relative",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  bgcolor: canvasBackground,
  borderTop: `1px solid ${mapBorder}`,
};

export const treeItemSlotProps = {
  /*
   * Wraps to two lines rather than cutting at one. Sibling bays share a long
   * prefix — "Main store, aisle A, bay 1/2/3" — so a single truncated line
   * rendered three different shelves as the identical "Main store, aisle A…"
   * and left the code underneath as the only thing telling them apart.
   */
  primary: {
    fontSize: "0.84rem",
    fontWeight: 700,
    color: "#17243B",
    sx: {
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: 2,
      overflow: "hidden",
      lineHeight: 1.3,
    },
  },
  secondary: {
    noWrap: true,
    fontSize: "0.72rem",
    color: "#667085",
  },
} as const;

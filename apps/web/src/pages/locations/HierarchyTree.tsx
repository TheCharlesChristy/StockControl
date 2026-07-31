import AccountTreeRounded from "@mui/icons-material/AccountTreeRounded";
import BusinessRounded from "@mui/icons-material/BusinessRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import FolderRounded from "@mui/icons-material/FolderRounded";
import { Box, IconButton, List, ListItemButton, ListItemText, styled } from "@mui/material";
import {
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
} from "react";
import type { HierarchyNodeView } from "@stockcontrol/contracts";

import { treeItemSlotProps } from "./constants";

/**
 * Compiled once, at module load. The old tree built a fresh `sx` object with
 * nested `:hover` and `.Mui-selected` rules for every node on every render, so
 * Emotion re-serialised the whole tree during a canvas drag. Depth arrives as a
 * custom property, which means every row shares one class.
 */
const TreeRow = styled(ListItemButton)({
  position: "relative",
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr)",
  alignItems: "center",
  gap: 4,
  minHeight: 48,
  paddingLeft: 4,
  paddingRight: 8,
  borderRadius: 8,
  "&:hover": { backgroundColor: "#F3F6FB" },
  "&.Mui-selected": {
    backgroundColor: "#E8EEF9",
    boxShadow: "inset 3px 0 0 #00309D",
    "&:hover": { backgroundColor: "#E8EEF9" },
  },
});

/*
 * The expander sits beside the row rather than inside it. Nesting a button in a
 * button is a real accessibility failure (axe `nested-interactive`), and the
 * previous tree also put bare buttons directly inside a `<ul>`.
 */
const TreeItem = styled("li")({
  display: "grid",
  gridTemplateColumns: "20px minmax(0, 1fr)",
  alignItems: "center",
  gap: 4,
  listStyle: "none",
  paddingLeft: "calc(4px + var(--tree-depth, 0) * 16px)",
});

const toggleSx = { p: 0, width: 20, height: 20 } as const;
const iconSx = { display: "grid", placeItems: "center", color: "primary.main" } as const;
const spacerSx = { width: 20, height: 20 } as const;
const textSx = { minWidth: 0, my: 0 } as const;

function HierarchyIcon({
  nodeKind,
}: {
  readonly nodeKind: HierarchyNodeView["nodeKind"];
}): ReactElement {
  if (nodeKind === "Branch") return <AccountTreeRounded fontSize="small" />;
  if (nodeKind === "Building") return <BusinessRounded fontSize="small" />;
  return <FolderRounded fontSize="small" />;
}

interface HierarchyTreeItemProps {
  readonly node: HierarchyNodeView;
  readonly depth: number;
  readonly selected: boolean;
  readonly collapsed: boolean;
  readonly onSelect: (node: HierarchyNodeView) => void;
  readonly onToggle: (id: string) => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>, node: HierarchyNodeView) => void;
}

const HierarchyTreeItem = memo(function HierarchyTreeItem({
  node,
  depth,
  selected,
  collapsed,
  onSelect,
  onToggle,
  onContextMenu,
}: HierarchyTreeItemProps): ReactElement {
  const hasChildren = node.children.length > 0;

  return (
    <TreeItem style={{ "--tree-depth": depth } as CSSProperties}>
      {hasChildren ? (
        <IconButton
          size="small"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.name}`}
          aria-expanded={!collapsed}
          onClick={() => {
            onToggle(node.id);
          }}
          sx={toggleSx}
        >
          {collapsed ? (
            <ChevronRightRounded fontSize="small" />
          ) : (
            <ExpandMoreRounded fontSize="small" />
          )}
        </IconButton>
      ) : (
        <Box sx={spacerSx} />
      )}
      <TreeRow
        selected={selected}
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          onSelect(node);
        }}
        onContextMenu={(event) => {
          onContextMenu(event, node);
        }}
      >
        <Box sx={iconSx}>
          <HierarchyIcon nodeKind={node.nodeKind} />
        </Box>
        <ListItemText
          primary={node.name}
          secondary={node.code}
          sx={textSx}
          slotProps={treeItemSlotProps}
        />
      </TreeRow>
    </TreeItem>
  );
});

interface HierarchyTreeProps {
  readonly root: HierarchyNodeView;
  readonly selectedId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onSelect: (node: HierarchyNodeView) => void;
  readonly onToggle: (id: string) => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>, node: HierarchyNodeView) => void;
}

interface VisibleRow {
  readonly node: HierarchyNodeView;
  readonly depth: number;
}

const visibleRows = (
  nodes: readonly HierarchyNodeView[],
  collapsedIds: ReadonlySet<string>,
  depth = 0,
): readonly VisibleRow[] =>
  nodes.flatMap((node) => [
    { node, depth },
    ...(collapsedIds.has(node.id) ? [] : visibleRows(node.children, collapsedIds, depth + 1)),
  ]);

export const HierarchyTree = memo(function HierarchyTree({
  root,
  selectedId,
  collapsedIds,
  onSelect,
  onToggle,
  onContextMenu,
}: HierarchyTreeProps): ReactElement {
  const rows = useMemo(() => visibleRows([root], collapsedIds), [root, collapsedIds]);
  const select = useCallback(
    (node: HierarchyNodeView) => {
      onSelect(node);
    },
    [onSelect],
  );

  return (
    <List dense disablePadding aria-label="Location hierarchy">
      {rows.map((row) => (
        <HierarchyTreeItem
          key={row.node.id}
          node={row.node}
          depth={row.depth}
          selected={selectedId === row.node.id}
          collapsed={collapsedIds.has(row.node.id)}
          onSelect={select}
          onToggle={onToggle}
          onContextMenu={onContextMenu}
        />
      ))}
    </List>
  );
});

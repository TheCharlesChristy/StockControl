import AccountTreeRounded from "@mui/icons-material/AccountTreeRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import ArchiveRounded from "@mui/icons-material/ArchiveRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  CreateHierarchyNodeRequest,
  HierarchyNodeView,
  LocationSearchResult,
} from "@stockcontrol/contracts";
import { memo, useEffect, useMemo, useState, type MouseEvent, type ReactElement } from "react";

import { panelBorder } from "./constants";
import { HierarchyTree } from "./HierarchyTree";

type CreatableKind = "Building" | "Area" | "Aisle" | "Shelf" | "Bin" | "CustomSection";

const creatableKinds: readonly CreatableKind[] = [
  "Building",
  "Area",
  "Aisle",
  "Shelf",
  "Bin",
  "CustomSection",
];

interface HierarchyPanelProps {
  readonly canEdit: boolean;
  readonly root: HierarchyNodeView | null;
  readonly buildings: readonly HierarchyNodeView[];
  readonly nodes: readonly HierarchyNodeView[];
  readonly selectedNodeId: string | null;
  readonly selectedBuildingId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly query: string;
  readonly searchResults: readonly LocationSearchResult[] | undefined;
  readonly focusedRegionId: string | null;
  readonly onQueryChange: (value: string) => void;
  readonly onSelectSearchResult: (result: LocationSearchResult) => void;
  readonly onSelectNode: (node: HierarchyNodeView) => void;
  readonly onToggleNode: (id: string) => void;
  readonly onCreateNode: (request: CreateHierarchyNodeRequest) => void;
  readonly onRenameNode: (id: string, name: string) => void;
  readonly onMoveNode: (id: string, parentId: string) => void;
  readonly onArchiveNode: (id: string) => void;
  readonly onDeleteNode: (id: string) => void;
}

const searchResultSx = { minHeight: 44 } as const;

/**
 * The left sidebar. The creation and rename form keeps its own state, so typing
 * a location name never reaches the map canvas.
 */
export const HierarchyPanel = memo(function HierarchyPanel({
  canEdit,
  root,
  buildings,
  nodes,
  selectedNodeId,
  selectedBuildingId,
  collapsedIds,
  query,
  searchResults,
  focusedRegionId,
  onQueryChange,
  onSelectSearchResult,
  onSelectNode,
  onToggleNode,
  onCreateNode,
  onRenameNode,
  onMoveNode,
  onArchiveNode,
  onDeleteNode,
}: HierarchyPanelProps): ReactElement {
  const [newNodeCode, setNewNodeCode] = useState("");
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeKind, setNewNodeKind] = useState<CreatableKind>("Area");
  const [newNodeParentId, setNewNodeParentId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameMenu, setRenameMenu] = useState<{
    readonly anchorX: number;
    readonly anchorY: number;
    readonly node: HierarchyNodeView;
  } | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const branchId = root?.id ?? null;
  const parentId = newNodeParentId ?? (newNodeKind === "Building" ? branchId : selectedBuildingId);

  useEffect(() => {
    setRenameValue(selectedNode?.name ?? "");
  }, [selectedNode]);

  const handleContextMenu = (event: MouseEvent<HTMLElement>, node: HierarchyNodeView): void => {
    if (!canEdit || node.nodeKind !== "Building") return;
    event.preventDefault();
    setRenameMenu({ anchorX: event.clientX, anchorY: event.clientY, node });
  };

  const parentOptions = useMemo(
    () =>
      nodes.filter((node) =>
        newNodeKind === "Building"
          ? node.nodeKind === "Branch"
          : node.nodeKind !== "Bin" && node.nodeKind !== "Branch",
      ),
    [nodes, newNodeKind],
  );
  const moveOptions = useMemo(
    () => nodes.filter((node) => node.id !== selectedNodeId && node.status === "Active"),
    [nodes, selectedNodeId],
  );

  return (
    <Box
      component="aside"
      aria-label="Location hierarchy and search"
      sx={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        minWidth: 0,
        minHeight: { xs: 420, lg: 0 },
        overflow: "hidden",
        borderRight: { lg: `1px solid ${panelBorder}` },
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: `1px solid ${panelBorder}` }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <AccountTreeRounded fontSize="small" color="primary" />
            <Typography sx={{ fontWeight: 800 }}>Locations</Typography>
          </Stack>
          {canEdit && (
            <Tooltip title="Add location">
              <IconButton
                size="small"
                aria-label="Add location"
                onClick={() => document.getElementById("new-location-code")?.focus()}
              >
                <AddRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <TextField
          fullWidth
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          placeholder="Search locations…"
          size="small"
          slotProps={{
            htmlInput: { "aria-label": "Search locations" },
            input: {
              startAdornment: (
                <SearchRounded fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />
              ),
            },
          }}
        />
      </Box>
      <Box sx={{ minHeight: 0, overflowY: "auto", p: 1.25 }}>
        {searchResults !== undefined && query.trim().length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
              Search results
            </Typography>
            <List dense disablePadding aria-label="Search results">
              {searchResults.map((result) => (
                <ListItemButton
                  key={`${result.mapId ?? "location"}-${result.location.id}`}
                  selected={focusedRegionId === result.regionId}
                  onClick={() => {
                    onSelectSearchResult(result);
                  }}
                  sx={searchResultSx}
                >
                  <ListItemText
                    primary={result.location.name}
                    secondary={`${result.location.code} · ${result.matchedOn}`}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1 }}>
          <Typography variant="overline" color="text.secondary">
            Hierarchy
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {buildings.length} building{buildings.length === 1 ? "" : "s"}
          </Typography>
        </Stack>
        {root === null || buildings.length === 0 ? (
          <Typography color="text.secondary" sx={{ px: 1, py: 2 }}>
            No buildings configured yet.
          </Typography>
        ) : (
          <HierarchyTree
            root={root}
            selectedId={selectedNodeId}
            collapsedIds={collapsedIds}
            onSelect={onSelectNode}
            onToggle={onToggleNode}
            onContextMenu={handleContextMenu}
          />
        )}
        <Menu
          open={renameMenu !== null}
          onClose={() => setRenameMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={
            renameMenu === null ? undefined : { top: renameMenu.anchorY, left: renameMenu.anchorX }
          }
        >
          <MenuItem
            onClick={() => {
              if (renameMenu !== null) {
                onSelectNode(renameMenu.node);
                setRenameMenu(null);
                window.setTimeout(
                  () => document.getElementById("rename-location-name")?.focus(),
                  0,
                );
              }
            }}
          >
            Rename building
          </MenuItem>
        </Menu>
        {canEdit && (
          <Stack spacing={1} sx={{ mt: 2, pt: 2, px: 1, borderTop: `1px solid ${panelBorder}` }}>
            <Typography variant="overline" color="text.secondary">
              Add hierarchy node
            </Typography>
            <TextField
              id="new-location-code"
              size="small"
              label="Code"
              value={newNodeCode}
              onChange={(event) => {
                setNewNodeCode(event.target.value);
              }}
            />
            <TextField
              size="small"
              label="Name"
              value={newNodeName}
              onChange={(event) => {
                setNewNodeName(event.target.value);
              }}
            />
            <FormControl size="small">
              <InputLabel id="new-node-kind-label">Type</InputLabel>
              <Select
                labelId="new-node-kind-label"
                label="Type"
                value={newNodeKind}
                onChange={(event) => {
                  const kind = event.target.value;
                  setNewNodeKind(kind);
                  if (kind === "Building") setNewNodeParentId(branchId);
                  else if (newNodeParentId === branchId) setNewNodeParentId(null);
                }}
              >
                {creatableKinds.map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {kind}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel id="new-node-parent-label">Parent</InputLabel>
              <Select
                labelId="new-node-parent-label"
                label="Parent"
                value={parentId ?? ""}
                onChange={(event) => {
                  setNewNodeParentId(event.target.value);
                }}
              >
                {parentOptions.map((node) => (
                  <MenuItem key={node.id} value={node.id}>
                    {node.name} · {node.code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              startIcon={<AddRounded />}
              onClick={() => {
                if (parentId === null) return;
                onCreateNode({
                  code: newNodeCode,
                  name: newNodeName,
                  nodeKind: newNodeKind,
                  operationalKind: newNodeKind === "Building" ? "Container" : "Storage",
                  parentId,
                });
                setNewNodeCode("");
                setNewNodeName("");
              }}
            >
              Add location
            </Button>
            {selectedNode !== undefined && selectedNode.nodeKind !== "Branch" && (
              <Stack spacing={1} sx={{ pt: 1.5, borderTop: `1px solid ${panelBorder}` }}>
                <Typography variant="overline" color="text.secondary">
                  Edit selected location
                </Typography>
                <TextField
                  id="rename-location-name"
                  size="small"
                  label="Name"
                  value={renameValue}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                  }}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      onRenameNode(selectedNode.id, renameValue);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<ArchiveRounded />}
                    onClick={() => {
                      onArchiveNode(selectedNode.id);
                    }}
                  >
                    Archive
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    startIcon={<DeleteOutlineRounded />}
                    onClick={() => {
                      onDeleteNode(selectedNode.id);
                    }}
                    disabled={selectedNode.status === "Archived"}
                  >
                    Delete
                  </Button>
                </Stack>
                <FormControl size="small">
                  <InputLabel id="move-location-parent-label">Move under</InputLabel>
                  <Select
                    labelId="move-location-parent-label"
                    label="Move under"
                    value={selectedNode.parentId ?? "none"}
                    onChange={(event) => {
                      if (event.target.value !== "none")
                        onMoveNode(selectedNode.id, event.target.value);
                    }}
                  >
                    <MenuItem value="none">No parent</MenuItem>
                    {moveOptions.map((node) => (
                      <MenuItem key={node.id} value={node.id}>
                        {node.name} · {node.code}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
});

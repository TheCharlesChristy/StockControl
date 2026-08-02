import AddRounded from "@mui/icons-material/AddRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import FolderRounded from "@mui/icons-material/FolderRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  styled,
} from "@mui/material";
import type {
  CreateMapRequest,
  LocationSearchResult,
  MapLocationView,
  MapSummaryView,
} from "@stockcontrol/contracts";
import {
  Fragment,
  memo,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactElement,
} from "react";

import { panelBorder, treeItemSlotProps } from "./constants";

/*
 * One compiled class for every row, with depth passed as a custom property.
 * Building a fresh `sx` per row re-serialised the whole list during a drag.
 */
const ListRow = styled(ListItemButton)({
  position: "relative",
  display: "grid",
  gridTemplateColumns: "28px 24px minmax(0, 1fr)",
  alignItems: "center",
  gap: 4,
  minHeight: 48,
  borderRadius: 8,
  paddingRight: 8,
  paddingLeft: "calc(4px + var(--tree-depth, 0) * 16px)",
  "&:hover": { backgroundColor: "#F3F6FB" },
  "&.Mui-selected": {
    backgroundColor: "#E8EEF9",
    boxShadow: "inset 3px 0 0 #00309D",
    "&:hover": { backgroundColor: "#E8EEF9" },
  },
});

const iconSx = { display: "grid", placeItems: "center" } as const;
const textSx = { minWidth: 0, my: 0 } as const;
const searchResultSx = { minHeight: 44 } as const;

interface LocationListPanelProps {
  readonly canEdit: boolean;
  readonly maps: readonly MapSummaryView[];
  readonly selectedMapId: string | null;
  readonly locations: readonly MapLocationView[];
  readonly selectedLocationId: string | null;
  readonly query: string;
  readonly searchResults: readonly LocationSearchResult[] | undefined;
  readonly onQueryChange: (value: string) => void;
  readonly onSelectSearchResult: (result: LocationSearchResult) => void;
  readonly onSelectMap: (mapId: string) => void;
  readonly onSelectLocation: (id: string) => void;
  readonly onOpenDetails: (id: string) => void;
  readonly onOpenContextMenu: (
    id: string,
    position: { readonly top: number; readonly left: number },
  ) => void;
  readonly onCreateMap: (request: CreateMapRequest) => void;
}

/**
 * The map's contents as a list. The indentation and collapsible groups are the
 * implicit hierarchy — read straight off the shapes — so there is nothing here
 * to edit: no parent picker, no move, no create-node form. A location appears
 * by being drawn.
 */
export const LocationListPanel = memo(function LocationListPanel({
  canEdit,
  maps,
  selectedMapId,
  locations,
  selectedLocationId,
  query,
  searchResults,
  onQueryChange,
  onSelectSearchResult,
  onSelectMap,
  onSelectLocation,
  onOpenDetails,
  onOpenContextMenu,
  onCreateMap,
}: LocationListPanelProps): ReactElement {
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [newMapCode, setNewMapCode] = useState("");
  const [newMapName, setNewMapName] = useState("");
  const [collapsedLocations, setCollapsedLocations] = useState<ReadonlySet<string>>(new Set());

  const { childrenByParent, roots } = useMemo(() => {
    const locationIds = new Set(locations.map((location) => location.id));
    const childrenByParent = new Map<string, MapLocationView[]>();
    const roots: MapLocationView[] = [];

    for (const location of locations) {
      const parentId = location.derivedParentId;
      if (parentId === null || !locationIds.has(parentId)) {
        roots.push(location);
        continue;
      }
      const children = childrenByParent.get(parentId) ?? [];
      children.push(location);
      childrenByParent.set(parentId, children);
    }

    return { childrenByParent, roots };
  }, [locations]);

  const toggleCollapsed = (id: string): void => {
    setCollapsedLocations((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderLocation = (location: MapLocationView): ReactElement => {
    const children = childrenByParent.get(location.id) ?? [];
    const expanded = !collapsedLocations.has(location.id);

    return (
      <Fragment key={location.id}>
        <ListRow
          style={{ "--tree-depth": location.depth } as CSSProperties}
          selected={selectedLocationId === location.id}
          aria-current={selectedLocationId === location.id ? "true" : undefined}
          onClick={() => {
            onSelectLocation(location.id);
          }}
          onDoubleClick={() => {
            onSelectLocation(location.id);
            onOpenDetails(location.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onSelectLocation(location.id);
            onOpenContextMenu(location.id, { top: event.clientY, left: event.clientX });
          }}
        >
          {children.length > 0 ? (
            <IconButton
              size="small"
              aria-label={expanded ? `Collapse ${location.name}` : `Expand ${location.name}`}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapsed(location.id);
              }}
              sx={{ p: 0.25 }}
            >
              {expanded ? (
                <ExpandMoreRounded fontSize="small" />
              ) : (
                <ChevronRightRounded fontSize="small" />
              )}
            </IconButton>
          ) : (
            <Box aria-hidden="true" />
          )}
          <Box sx={{ ...iconSx, color: location.stock.colour }} title={location.stock.text}>
            {location.stock.itemCount > 0 ? (
              <Inventory2Rounded fontSize="small" />
            ) : (
              <FolderRounded fontSize="small" />
            )}
          </Box>
          <ListItemText
            primary={location.name}
            secondary={location.code === "" ? "New — code set on save" : location.code}
            sx={textSx}
            slotProps={treeItemSlotProps}
            title={location.path === "" ? location.name : location.path}
          />
        </ListRow>
        {children.length > 0 && (
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {children.map(renderLocation)}
            </List>
          </Collapse>
        )}
      </Fragment>
    );
  };

  const submitNewMap = (event: FormEvent): void => {
    event.preventDefault();
    if (newMapCode.trim().length === 0 || newMapName.trim().length === 0) return;
    onCreateMap({ code: newMapCode.trim().toUpperCase(), name: newMapName.trim() });
    setNewMapCode("");
    setNewMapName("");
    setNewMapOpen(false);
  };

  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.5, minHeight: 0 }}>
      <TextField
        fullWidth
        size="small"
        label="Search locations"
        data-help-target="locations-search"
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        slotProps={{ input: { startAdornment: <SearchRounded fontSize="small" /> } }}
      />
      {searchResults !== undefined && searchResults.length > 0 && (
        <List dense disablePadding component="div" aria-label="Search results">
          {searchResults.map((result) => (
            <ListItemButton
              key={result.id}
              sx={searchResultSx}
              onClick={() => {
                onSelectSearchResult(result);
              }}
            >
              <ListItemText
                primary={result.name}
                secondary={result.path === "" ? result.code : result.path}
                slotProps={treeItemSlotProps}
              />
            </ListItemButton>
          ))}
        </List>
      )}

      <FormControl fullWidth size="small">
        <InputLabel id="map-select-label">Map</InputLabel>
        <Select
          labelId="map-select-label"
          label="Map"
          value={selectedMapId ?? ""}
          onChange={(event) => {
            onSelectMap(event.target.value);
          }}
        >
          {maps.map((map) => (
            <MenuItem key={map.id} value={map.id}>
              {map.name} · {map.code}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {canEdit && (
        <Button
          size="small"
          startIcon={<AddRounded />}
          onClick={() => {
            setNewMapOpen(true);
          }}
        >
          New map
        </Button>
      )}

      <Box sx={{ borderTop: `1px solid ${panelBorder}`, pt: 1, minHeight: 0, overflowY: "auto" }}>
        <Typography variant="overline" color="text.secondary">
          On this map
        </Typography>
        {locations.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {canEdit
              ? "Nothing drawn yet. Use the rectangle or polygon tool to add a location."
              : "Nothing has been drawn on this map yet."}
          </Typography>
        ) : (
          <List dense disablePadding component="div" aria-label="Locations on this map">
            {roots.map(renderLocation)}
          </List>
        )}
      </Box>

      <Dialog
        open={newMapOpen}
        onClose={() => {
          setNewMapOpen(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <form onSubmit={submitNewMap}>
          <DialogTitle>New map</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                A map is a blank canvas — a floor, a unit, a yard. Draw locations on it once it
                exists.
              </Typography>
              <TextField
                autoFocus
                fullWidth
                size="small"
                label="Map code"
                value={newMapCode}
                onChange={(event) => {
                  setNewMapCode(event.target.value);
                }}
              />
              <TextField
                fullWidth
                size="small"
                label="Map name"
                value={newMapName}
                onChange={(event) => {
                  setNewMapName(event.target.value);
                }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setNewMapOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="contained">
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
});

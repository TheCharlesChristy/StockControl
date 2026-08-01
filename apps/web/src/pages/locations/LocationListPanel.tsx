import AddRounded from "@mui/icons-material/AddRounded";
import FolderRounded from "@mui/icons-material/FolderRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
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
import { memo, useState, type CSSProperties, type FormEvent, type ReactElement } from "react";

import { panelBorder, treeItemSlotProps } from "./constants";

/*
 * One compiled class for every row, with depth passed as a custom property.
 * Building a fresh `sx` per row re-serialised the whole list during a drag.
 */
const ListRow = styled(ListItemButton)({
  position: "relative",
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr)",
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

const iconSx = { display: "grid", placeItems: "center", color: "primary.main" } as const;
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
  readonly onCreateMap: (request: CreateMapRequest) => void;
}

/**
 * The map's contents as a list. The indentation is the implicit hierarchy —
 * read straight off the shapes — so there is nothing here to edit: no parent
 * picker, no move, no create-node form. A location appears by being drawn.
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
  onCreateMap,
}: LocationListPanelProps): ReactElement {
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [newMapCode, setNewMapCode] = useState("");
  const [newMapName, setNewMapName] = useState("");

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
            {locations.map((location) => (
              <ListRow
                key={location.id}
                style={{ "--tree-depth": location.depth } as CSSProperties}
                selected={selectedLocationId === location.id}
                aria-current={selectedLocationId === location.id ? "true" : undefined}
                onClick={() => {
                  onSelectLocation(location.id);
                }}
              >
                <Box sx={iconSx}>
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
            ))}
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

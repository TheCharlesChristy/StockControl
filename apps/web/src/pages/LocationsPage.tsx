import { Alert, Box, Button, Menu, MenuItem, Snackbar, Stack, Typography } from "@mui/material";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { CreateMapRequest, LocationSearchResult, MapGeometry } from "@stockcontrol/contracts";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
import { useCapability } from "../auth/useCapability";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { mapBorder } from "./locations/constants";
import {
  editorReducer,
  initialEditor,
  toInputs,
  type EditorMode,
  type LocationChanges,
} from "./locations/editor-state";
import { LocationDetailsDialog } from "./locations/LocationDetailsDialog";
import { LocationListPanel } from "./locations/LocationListPanel";
import { MapWorkspace } from "./locations/MapWorkspace";
import { validateMapRules, type MapRuleViolation } from "./locations/map-rules";

const SEARCH_DEBOUNCE_MS = 250;

interface LocationContextMenu {
  readonly locationId: string;
  readonly top: number;
  readonly left: number;
}

/**
 * The locations screen: the map's contents on the left and the map in the
 * middle. Hierarchy is derived from the shapes, while details and editing are
 * available from the map or its contents list.
 *
 * This component only loads data and owns the committed editor state — pan,
 * zoom and in-flight drag geometry live under `./locations`, which is what
 * keeps a drag from re-rendering the page.
 */
export function LocationsPage(): ReactElement {
  const api = useApi();
  /*
   * Editing the map is one capability, resolved through the shared role map
   * rather than a role name, so a change to ROLE_CAPABILITIES carries this
   * screen with it. The server checks the same capability again.
   */
  const canEdit = useCapability("manageLocations");
  const [mapId, setMapId] = useState<string | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, initialEditor);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [detailsLocationId, setDetailsLocationId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<LocationContextMenu | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const mapList = useResource(useCallback((signal: AbortSignal) => api.listMaps(signal), [api]));
  const maps = useMemo(() => mapList.data ?? [], [mapList.data]);
  const selectedMapId = mapId ?? maps[0]?.id ?? null;
  const persistedMapId = editor.persisted?.id ?? null;
  const persistedRevision = editor.persisted?.revision ?? -1;

  const mapResource = useResource(
    useCallback(
      (signal: AbortSignal) =>
        selectedMapId === null
          ? Promise.reject(new Error("No map"))
          : api.getMap(selectedMapId, signal),
      [api, selectedMapId],
    ),
  );
  const searchResource = useResource(
    useCallback(
      (signal: AbortSignal) =>
        debouncedQuery.trim().length < 2
          ? Promise.resolve([])
          : api.searchLocations(debouncedQuery, signal),
      [api, debouncedQuery],
    ),
  );

  /*
   * Adopt what the server sends, unless we already hold something newer. A save
   * leaves the page a revision ahead of the last fetch, and loading that stale
   * copy over it would throw the selection away the moment you pressed Save.
   */
  useEffect(() => {
    const fetched = mapResource.data;
    if (fetched === undefined) return;
    if (fetched.id === persistedMapId && fetched.revision <= persistedRevision) return;
    dispatch({ type: "load", map: fetched });
  }, [mapResource.data, persistedMapId, persistedRevision]);

  const draft = editor.draft;
  const locations = useMemo(() => draft?.locations ?? [], [draft]);
  const detailsLocation = useMemo(
    () => locations.find((location) => location.id === detailsLocationId) ?? null,
    [detailsLocationId, locations],
  );
  const ruleViolations = useMemo<readonly MapRuleViolation[]>(
    () => validateMapRules(locations),
    [locations],
  );
  const selectedMap = useMemo(
    () => maps.find((map) => map.id === selectedMapId),
    [maps, selectedMapId],
  );

  /* Display order follows the derived tree: a parent, then what sits inside it. */
  const listedLocations = useMemo(
    () =>
      [...locations].sort(
        (left, right) =>
          left.path.localeCompare(right.path, "en-GB") || left.name.localeCompare(right.name),
      ),
    [locations],
  );

  const reportFailure = useCallback((error: unknown, fallback: string): void => {
    if (error instanceof ApiError && error.status === 409) {
      setConflict(true);
      return;
    }
    setSaveMessage(error instanceof Error ? error.message : fallback);
  }, []);

  const save = useCallback((): void => {
    if (!canEdit || draft === null || editor.persisted === null) return;
    if (ruleViolations.length > 0) {
      setSaveMessage("Cannot save with rule violations");
      return;
    }
    setSaveMessage(null);
    setConflict(false);
    api
      .saveMap(draft.id, {
        expectedRevision: editor.persisted.revision,
        locations: toInputs(draft),
      })
      .then((saved) => {
        dispatch({ type: "saved", map: saved });
        setSaveMessage("Map saved");
      })
      .catch((error: unknown) => {
        reportFailure(error, "Map could not be saved");
      });
  }, [api, canEdit, draft, editor.persisted, reportFailure, ruleViolations]);

  const uploadFloorPlan = useCallback(
    (file: File): void => {
      if (!canEdit || draft === null || editor.persisted === null) return;
      if (ruleViolations.length > 0) {
        setSaveMessage("Cannot save with rule violations");
        return;
      }
      if (file.type !== "image/png" && file.type !== "image/jpeg") {
        setSaveMessage("Choose a PNG or JPEG floor plan.");
        return;
      }
      setSaveMessage(null);
      setConflict(false);
      const reader = new FileReader();
      reader.addEventListener("error", () => {
        setSaveMessage("Floor plan could not be read.");
      });
      reader.addEventListener("load", () => {
        const value = typeof reader.result === "string" ? reader.result : "";
        api
          .uploadFloorPlan(draft.id, {
            expectedRevision: editor.persisted?.revision ?? draft.revision,
            locations: toInputs(draft),
            originalFileName: file.name,
            mediaType: file.type as "image/png" | "image/jpeg",
            contentBase64: value.split(",", 2)[1] ?? "",
          })
          .then((saved) => {
            dispatch({ type: "saved", map: saved });
            setSaveMessage("Floor plan uploaded and map saved");
          })
          .catch((error: unknown) => {
            reportFailure(error, "Floor plan could not be uploaded");
          });
      });
      reader.readAsDataURL(file);
    },
    [api, canEdit, draft, editor.persisted, reportFailure, ruleViolations],
  );

  const createMap = useCallback(
    (request: CreateMapRequest): void => {
      api
        .createMap(request)
        .then((created) => {
          setMapId(created.id);
          dispatch({ type: "load", map: created });
          setSaveMessage("Map created");
          mapList.reload();
        })
        .catch((error: unknown) => {
          reportFailure(error, "Map could not be created");
        });
    },
    [api, mapList, reportFailure],
  );

  const selectSearchResult = useCallback((result: LocationSearchResult): void => {
    if (result.mapId !== null) setMapId(result.mapId);
    dispatch({ type: "select", id: result.id });
  }, []);

  const selectLocation = useCallback((id: string | null): void => {
    dispatch({ type: "select", id });
  }, []);
  const selectMap = useCallback((id: string): void => {
    setMapId(id);
  }, []);
  const openLocationDetails = useCallback((id: string): void => {
    dispatch({ type: "select", id });
    setContextMenu(null);
    setDetailsLocationId(id);
  }, []);
  const openLocationContextMenu = useCallback(
    (id: string, position: { readonly top: number; readonly left: number }): void => {
      dispatch({ type: "select", id });
      setContextMenu({ locationId: id, ...position });
    },
    [],
  );
  const commitGeometry = useCallback((id: string, geometry: MapGeometry): void => {
    dispatch({ type: "commit-geometry", id, geometry });
  }, []);
  const createLocation = useCallback((geometry: MapGeometry): void => {
    dispatch({ type: "add-location", geometry });
  }, []);
  const removeLocation = useCallback((id: string): void => {
    dispatch({ type: "remove-location", id });
  }, []);
  const patchLocation = useCallback((id: string, changes: LocationChanges): void => {
    dispatch({ type: "patch-location", id, changes });
  }, []);
  const reorderLocation = useCallback((id: string, direction: "raise" | "lower"): void => {
    dispatch({ type: "reorder-location", id, direction });
  }, []);
  const changeMode = useCallback((mode: EditorMode): void => {
    dispatch({ type: "mode", mode });
  }, []);
  const toggleSnap = useCallback((): void => {
    dispatch({ type: "toggle-snap" });
  }, []);
  const revert = useCallback((): void => {
    dispatch({ type: "revert" });
  }, []);
  const closeDetails = useCallback((): void => {
    setDetailsLocationId(null);
  }, []);
  const dismissNotification = useCallback((): void => {
    setConflict(false);
    setSaveMessage(null);
  }, []);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: { xs: 1.5, lg: 2 },
        minWidth: 0,
        minHeight: 0,
        height: { lg: "100%" },
        overflow: { lg: "hidden" },
      }}
    >
      <Box component="header" sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ md: "center" }}
          spacing={1.5}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", letterSpacing: "0.08em" }}
            >
              Locations
            </Typography>
            <Typography
              variant="h1"
              component="h1"
              sx={{ fontSize: { xs: "1.6rem", sm: "2rem" }, lineHeight: 1.15 }}
            >
              {selectedMap?.name ?? "Locations"}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {selectedMap?.code ?? "Create a map to start drawing locations"}
            </Typography>
          </Box>
        </Stack>
      </Box>
      <Snackbar
        key={conflict ? "map-conflict" : (saveMessage ?? "map-notice")}
        open={conflict || saveMessage !== null}
        autoHideDuration={4500}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        onClose={(_, reason) => {
          if (reason !== "clickaway") dismissNotification();
        }}
        sx={{ mt: { xs: 1, sm: 2 }, mr: { xs: 1, sm: 2 } }}
      >
        <Alert
          severity={
            conflict
              ? "warning"
              : saveMessage?.endsWith("saved") || saveMessage?.endsWith("created")
                ? "success"
                : "error"
          }
          onClose={dismissNotification}
          action={
            conflict ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  dismissNotification();
                  mapResource.reload();
                }}
              >
                Reload latest
              </Button>
            ) : undefined
          }
          sx={{ width: "100%" }}
        >
          {conflict
            ? "Another save has occurred. Your unsaved draft is still preserved."
            : saveMessage}
        </Alert>
      </Snackbar>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: "280px minmax(0, 1fr)",
          },
          gridTemplateRows: { xs: "auto auto", lg: "minmax(0, 1fr)" },
          minWidth: 0,
          minHeight: 0,
          overflow: { xs: "visible", lg: "hidden" },
          border: "1px solid",
          borderColor: mapBorder,
          borderRadius: 1.5,
          bgcolor: "background.paper",
        }}
      >
        <LocationListPanel
          canEdit={canEdit}
          maps={maps}
          selectedMapId={selectedMapId}
          locations={listedLocations}
          selectedLocationId={editor.selectedLocationId}
          query={query}
          searchResults={searchResource.data}
          onQueryChange={setQuery}
          onSelectSearchResult={selectSearchResult}
          onSelectMap={selectMap}
          onSelectLocation={selectLocation}
          onOpenDetails={openLocationDetails}
          onOpenContextMenu={openLocationContextMenu}
          onCreateMap={createMap}
        />
        <MapWorkspace
          map={draft}
          canEdit={canEdit}
          dirty={editor.dirty}
          mode={editor.mode}
          snapEnabled={editor.snapEnabled}
          selectedLocationId={editor.selectedLocationId}
          canCreateMap={false}
          svgRef={svgRef}
          onModeChange={changeMode}
          onToggleSnap={toggleSnap}
          onSelect={selectLocation}
          onOpenDetails={openLocationDetails}
          onOpenContextMenu={openLocationContextMenu}
          onCommitGeometry={commitGeometry}
          onCreateLocation={createLocation}
          onRemoveLocation={removeLocation}
          onSave={save}
          onRevert={revert}
          onUploadFile={uploadFloorPlan}
          onCreateMap={() => undefined}
          onProblem={setSaveMessage}
          ruleViolations={ruleViolations}
        />
      </Box>
      <LocationDetailsDialog
        open={detailsLocationId !== null}
        location={detailsLocation}
        canEdit={canEdit}
        dirty={editor.dirty}
        onPatch={patchLocation}
        onReorder={reorderLocation}
        onRemove={removeLocation}
        onClose={closeDetails}
        onSave={save}
      />
      <Menu
        open={contextMenu !== null}
        onClose={() => {
          setContextMenu(null);
        }}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu === null ? undefined : { top: contextMenu.top, left: contextMenu.left }
        }
      >
        <MenuItem
          onClick={() => {
            const locationId = contextMenu?.locationId;
            setContextMenu(null);
            if (locationId !== undefined) openLocationDetails(locationId);
          }}
        >
          View details
        </MenuItem>
      </Menu>
    </Box>
  );
}

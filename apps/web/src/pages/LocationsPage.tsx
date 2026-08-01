import MapRounded from "@mui/icons-material/MapRounded";
import { Alert, Box, Button, Stack, Tooltip, Typography } from "@mui/material";
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
import { LocationInspector } from "./locations/LocationInspector";
import { LocationListPanel } from "./locations/LocationListPanel";
import { MapWorkspace } from "./locations/MapWorkspace";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The locations screen: the map's contents on the left, the map in the middle,
 * location details on the right. There is no hierarchy to manage — a location
 * exists because it is drawn, and it sits inside whatever it is drawn inside.
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
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

  useEffect(() => {
    if (
      mapResource.data !== undefined &&
      (mapResource.data.id !== persistedMapId || mapResource.data.revision !== persistedRevision)
    )
      dispatch({ type: "load", map: mapResource.data });
  }, [mapResource.data, persistedMapId, persistedRevision]);

  const draft = editor.draft;
  const locations = useMemo(() => draft?.locations ?? [], [draft]);
  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === editor.selectedLocationId) ?? null,
    [locations, editor.selectedLocationId],
  );
  const showInspector = inspectorOpen || selectedLocation !== null;
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
  }, [api, canEdit, draft, editor.persisted, reportFailure]);

  const uploadFloorPlan = useCallback(
    (file: File): void => {
      if (!canEdit || draft === null || editor.persisted === null) return;
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
    [api, canEdit, draft, editor.persisted, reportFailure],
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
  const closeInspector = useCallback((): void => {
    dispatch({ type: "select", id: null });
    setInspectorOpen(false);
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
          {canEdit && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<MapRounded />}
              onClick={() => svgRef.current?.focus()}
              disabled={draft === null}
            >
              Edit map
            </Button>
          )}
        </Stack>
        {(conflict || saveMessage !== null) && (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {conflict && (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" onClick={mapResource.reload}>
                    Reload latest
                  </Button>
                }
                sx={{ py: 0.25 }}
              >
                Another save has occurred. Your unsaved draft is still preserved.
              </Alert>
            )}
            {saveMessage !== null && (
              <Alert
                severity={
                  saveMessage.endsWith("saved") || saveMessage.endsWith("created")
                    ? "success"
                    : "error"
                }
                onClose={() => {
                  setSaveMessage(null);
                }}
                sx={{ py: 0.25 }}
              >
                {saveMessage}
              </Alert>
            )}
          </Stack>
        )}
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: showInspector ? "280px minmax(0, 1fr) 320px" : "280px minmax(0, 1fr) 46px",
          },
          gridTemplateRows: { xs: "auto auto auto", lg: "minmax(0, 1fr)" },
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
          onCommitGeometry={commitGeometry}
          onCreateLocation={createLocation}
          onRemoveLocation={removeLocation}
          onSave={save}
          onRevert={revert}
          onUploadFile={uploadFloorPlan}
          onCreateMap={() => undefined}
          onProblem={setSaveMessage}
        />
        {showInspector ? (
          <Box
            component="aside"
            aria-label="Location details"
            sx={{
              minWidth: 0,
              minHeight: { xs: 360, lg: 0 },
              overflowY: "auto",
              borderLeft: { lg: `1px solid ${mapBorder}` },
            }}
          >
            <LocationInspector
              location={selectedLocation}
              canEdit={canEdit}
              dirty={editor.dirty}
              onPatch={patchLocation}
              onReorder={reorderLocation}
              onRemove={removeLocation}
              onClose={closeInspector}
              onSave={save}
            />
          </Box>
        ) : (
          <Box
            component="aside"
            aria-label="Location details collapsed"
            sx={{
              display: { xs: "none", lg: "flex" },
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              p: 0.75,
              borderLeft: `1px solid ${mapBorder}`,
              bgcolor: "#FBFCFE",
            }}
          >
            <Tooltip title="Open location details" placement="left">
              <Button
                variant="text"
                size="small"
                aria-label="Open location details"
                onClick={() => {
                  setInspectorOpen(true);
                }}
                sx={{
                  minWidth: 0,
                  flexDirection: "column",
                  gap: 0.25,
                  px: 0.5,
                  py: 1,
                  fontSize: "0.7rem",
                  fontWeight: 800,
                  lineHeight: 1.2,
                }}
              >
                <MapRounded fontSize="small" />
                Details
              </Button>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
}

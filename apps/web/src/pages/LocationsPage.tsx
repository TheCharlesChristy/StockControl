import AddRounded from "@mui/icons-material/AddRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type {
  CreateHierarchyNodeRequest,
  HierarchyNodeView,
  LocationSearchResult,
  MapGeometry,
} from "@stockcontrol/contracts";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
import { useCapability } from "../auth/useCapability";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { mapBorder } from "./locations/constants";
import {
  editorReducer,
  flattenHierarchy,
  initialEditor,
  toInputs,
  type EditorMode,
  type RegionChanges,
} from "./locations/editor-state";
import { HierarchyPanel } from "./locations/HierarchyPanel";
import { MapWorkspace } from "./locations/MapWorkspace";
import { RegionInspector } from "./locations/RegionInspector";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The locations screen: hierarchy on the left, building map in the middle,
 * region details on the right. This component only loads data and owns the
 * committed editor state — pan, zoom and in-flight drag geometry live under
 * `./locations`, which is what keeps a drag from re-rendering the page.
 */
export function LocationsPage(): ReactElement {
  const api = useApi();
  /*
   * Editing the hierarchy and the map is one capability, resolved through the
   * shared role map rather than a role name, so a change to ROLE_CAPABILITIES
   * carries this screen with it. The server checks the same capability again.
   */
  const canEdit = useCapability("manageLocations");
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, initialEditor);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pendingFocusRegionId, setPendingFocusRegionId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const locations = useResource(
    useCallback(
      (signal: AbortSignal) => Promise.all([api.getLocationTree(signal), api.listMaps(signal)]),
      [api],
    ),
  );
  const maps = useMemo(() => locations.data?.[1] ?? [], [locations.data]);
  const buildings = useMemo(() => locations.data?.[0].buildings ?? [], [locations.data]);
  const selectedBuildingId = buildingId ?? buildings[0]?.id ?? null;
  const persistedMapId = editor.persisted?.id ?? null;
  const persistedRevision = editor.persisted?.revision ?? -1;

  const mapResource = useResource(
    useCallback(
      (signal: AbortSignal) =>
        selectedBuildingId === null
          ? Promise.reject(new Error("No Building"))
          : maps.some((map) => map.buildingId === selectedBuildingId)
            ? api.getMap(selectedBuildingId, signal)
            : Promise.reject(new Error("No map configured")),
      [api, maps, selectedBuildingId],
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

  /*
   * Applies a search hit once its building's map has arrived. Keyed on the map
   * rather than the draft: the old effect re-ran on every draft change, adding a
   * render to every frame of a drag.
   */
  useEffect(() => {
    if (pendingFocusRegionId === null) return;
    dispatch({ type: "select", id: pendingFocusRegionId });
  }, [persistedMapId, pendingFocusRegionId]);

  const draft = editor.draft;
  const regions = useMemo(() => draft?.regions ?? [], [draft]);
  const selectedRegion = useMemo(
    () => regions.find((region) => region.id === editor.selectedRegionId) ?? null,
    [regions, editor.selectedRegionId],
  );
  const showInspector = inspectorOpen || selectedRegion !== null;

  const hierarchyRoot = locations.data?.[0].root ?? null;
  const hierarchyNodes = useMemo(
    () => (hierarchyRoot === null ? [] : flattenHierarchy([hierarchyRoot])),
    [hierarchyRoot],
  );
  const nodesById = useMemo(
    () => new Map(hierarchyNodes.map((node) => [node.id, node])),
    [hierarchyNodes],
  );
  const assignableNodes = useMemo(
    () =>
      hierarchyNodes.filter(
        (node) => node.buildingId === draft?.buildingId && node.status === "Active",
      ),
    [hierarchyNodes, draft?.buildingId],
  );
  const parentRegionOptions = useMemo(
    () =>
      regions.filter((region) => region.id !== selectedRegion?.id && region.status === "Active"),
    [regions, selectedRegion?.id],
  );
  const selectedBuilding = useMemo(
    () => buildings.find((building) => building.id === selectedBuildingId),
    [buildings, selectedBuildingId],
  );
  const buildingHasMap = useMemo(
    () => maps.some((map) => map.buildingId === selectedBuildingId),
    [maps, selectedBuildingId],
  );

  const reloadAll = useCallback((): void => {
    locations.reload();
    mapResource.reload();
  }, [locations, mapResource]);

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
        regions: toInputs(draft),
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
            regions: toInputs(draft),
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

  const createMap = useCallback((): void => {
    if (selectedBuildingId === null) return;
    api
      .createMap(selectedBuildingId)
      .then((map) => {
        dispatch({ type: "load", map });
        locations.reload();
      })
      .catch((error: unknown) => {
        reportFailure(error, "Map could not be created");
      });
  }, [api, locations, reportFailure, selectedBuildingId]);

  const createNode = useCallback(
    (request: CreateHierarchyNodeRequest): void => {
      if (request.code.trim() === "" || request.name.trim() === "") {
        setSaveMessage("Enter a code, name, and parent location.");
        return;
      }
      api
        .createHierarchyNode(request)
        .then((created) => {
          if (created.nodeKind === "Building") {
            setBuildingId(created.id);
            setSelectedNodeId(created.id);
          }
          setSaveMessage("Hierarchy node created");
          reloadAll();
        })
        .catch((error: unknown) => {
          reportFailure(error, "Location could not be created");
        });
    },
    [api, reloadAll, reportFailure],
  );

  const renameNode = useCallback(
    (id: string, name: string): void => {
      api
        .renameLocation(id, name)
        .then(() => {
          setSaveMessage("Location renamed");
          reloadAll();
        })
        .catch((error: unknown) => {
          reportFailure(error, "Location could not be renamed");
        });
    },
    [api, reloadAll, reportFailure],
  );

  const moveNode = useCallback(
    (id: string, parentId: string): void => {
      api
        .moveLocation(id, parentId)
        .then(() => {
          setSaveMessage("Location moved");
          reloadAll();
        })
        .catch((error: unknown) => {
          reportFailure(error, "Location could not be moved");
        });
    },
    [api, reloadAll, reportFailure],
  );

  const archiveNode = useCallback(
    (id: string): void => {
      if (!window.confirm(`Archive ${nodesById.get(id)?.name ?? "this location"}?`)) return;
      api
        .archiveLocation(id)
        .then(() => {
          setSelectedNodeId(null);
          setSaveMessage("Location archived");
          reloadAll();
        })
        .catch((error: unknown) => {
          reportFailure(error, "Location could not be archived");
        });
    },
    [api, nodesById, reloadAll, reportFailure],
  );

  const deleteNode = useCallback(
    (id: string): void => {
      const node = nodesById.get(id);
      if (!window.confirm(`Delete ${node?.name ?? "this location"}?`)) return;
      api
        .deleteLocation(id)
        .then(() => {
          if (node?.nodeKind === "Building") setBuildingId(null);
          setSelectedNodeId(null);
          setSaveMessage("Location deleted");
          reloadAll();
        })
        .catch((error: unknown) => {
          reportFailure(error, "Location could not be deleted");
        });
    },
    [api, nodesById, reloadAll, reportFailure],
  );

  const selectNode = useCallback(
    (node: HierarchyNodeView): void => {
      setSelectedNodeId(node.id);
      if (node.nodeKind === "Building") setBuildingId(node.id);
      const region = regions.find((candidate) => candidate.hierarchyNodeId === node.id);
      if (region !== undefined) {
        setPendingFocusRegionId(region.id);
        dispatch({ type: "select", id: region.id });
      }
    },
    [regions],
  );

  const toggleNode = useCallback((id: string): void => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectSearchResult = useCallback((result: LocationSearchResult): void => {
    if (result.location.buildingId !== null) setBuildingId(result.location.buildingId);
    /* Select now for the map already on screen; the effect above covers the rest. */
    setPendingFocusRegionId(result.regionId);
    dispatch({ type: "select", id: result.regionId });
  }, []);

  const selectRegion = useCallback((id: string | null): void => {
    dispatch({ type: "select", id });
  }, []);
  const commitGeometry = useCallback((id: string, geometry: MapGeometry): void => {
    dispatch({ type: "commit-geometry", id, geometry });
  }, []);
  const createRegion = useCallback(
    (geometry: MapGeometry): void => {
      dispatch({
        type: "add-region",
        geometry,
        ...(editor.mode === "entrance" || editor.mode === "exit"
          ? { displayName: editor.mode === "entrance" ? "Entrance" : "Exit" }
          : {}),
      });
    },
    [editor.mode],
  );
  const removeRegion = useCallback((id: string): void => {
    dispatch({ type: "remove-region", id });
  }, []);
  const patchRegion = useCallback((id: string, changes: RegionChanges): void => {
    dispatch({ type: "patch-region", id, changes });
  }, []);
  const reorderRegion = useCallback((id: string, direction: "raise" | "lower"): void => {
    dispatch({ type: "reorder-region", id, direction });
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
          {/*
           * The building said once. This header used to name it four times over
           * — breadcrumb, heading, a "Building" chip, its code, and again inside
           * the selector — which is a lot of furniture for one fact. The
           * breadcrumb marks the section, the heading names the building, the
           * caption carries its code, and the selector is how you change it.
           */}
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
              {selectedBuilding?.name ?? "Locations"}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {selectedBuilding?.code ?? "Select a building to open its map"}
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="stretch">
            <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 240 } }}>
              <InputLabel id="building-label">Building</InputLabel>
              <Select
                labelId="building-label"
                label="Building"
                value={selectedBuildingId ?? ""}
                onChange={(event) => {
                  setBuildingId(event.target.value);
                }}
              >
                {buildings.map((building) => (
                  <MenuItem key={building.id} value={building.id}>
                    {building.name} · {building.code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {/*
             * Both of these only exist for a role that can actually change
             * something. A role that cannot gets no button at all rather than a
             * greyed stub or — worse — a live one that quietly does nothing:
             * the navigation already hides whole sections by role, and this is
             * the same idea one level down.
             */}
            {canEdit && (
              <>
                <Tooltip title="Jumps to the new-location form below the hierarchy">
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AddRounded />}
                      onClick={() => document.getElementById("new-location-code")?.focus()}
                      disabled={hierarchyRoot === null}
                    >
                      Add building
                    </Button>
                  </span>
                </Tooltip>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<MapRounded />}
                  onClick={() => svgRef.current?.focus()}
                  disabled={draft === null}
                >
                  Edit map
                </Button>
              </>
            )}
          </Stack>
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
                severity={saveMessage.endsWith("saved") ? "success" : "error"}
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
        <HierarchyPanel
          canEdit={canEdit}
          root={hierarchyRoot}
          buildings={buildings}
          nodes={hierarchyNodes}
          selectedNodeId={selectedNodeId}
          selectedBuildingId={selectedBuildingId}
          collapsedIds={collapsedIds}
          query={query}
          searchResults={searchResource.data}
          focusedRegionId={editor.selectedRegionId}
          onQueryChange={setQuery}
          onSelectSearchResult={selectSearchResult}
          onSelectNode={selectNode}
          onToggleNode={toggleNode}
          onCreateNode={createNode}
          onRenameNode={renameNode}
          onMoveNode={moveNode}
          onArchiveNode={archiveNode}
          onDeleteNode={deleteNode}
        />
        <MapWorkspace
          map={draft}
          canEdit={canEdit}
          dirty={editor.dirty}
          mode={editor.mode}
          snapEnabled={editor.snapEnabled}
          selectedRegionId={editor.selectedRegionId}
          canCreateMap={canEdit && !buildingHasMap && selectedBuildingId !== null}
          svgRef={svgRef}
          onModeChange={changeMode}
          onToggleSnap={toggleSnap}
          onSelect={selectRegion}
          onCommitGeometry={commitGeometry}
          onCreateRegion={createRegion}
          onRemoveRegion={removeRegion}
          onSave={save}
          onRevert={revert}
          onUploadFile={uploadFloorPlan}
          onCreateMap={createMap}
          onProblem={setSaveMessage}
        />
        {showInspector ? (
          <Box
            component="aside"
            aria-label="Region details"
            sx={{
              minWidth: 0,
              minHeight: { xs: 360, lg: 0 },
              overflowY: "auto",
              borderLeft: { lg: `1px solid ${mapBorder}` },
            }}
          >
            <RegionInspector
              region={selectedRegion}
              canEdit={canEdit}
              dirty={editor.dirty}
              locationCode={
                selectedRegion === null
                  ? ""
                  : (nodesById.get(selectedRegion.hierarchyNodeId)?.code ??
                    selectedRegion.hierarchyNodeId)
              }
              nodeOptions={assignableNodes}
              parentOptions={parentRegionOptions}
              onPatch={patchRegion}
              onReorder={reorderRegion}
              onRemove={removeRegion}
              onClose={closeInspector}
              onSave={save}
            />
          </Box>
        ) : (
          <Box
            component="aside"
            aria-label="Region details collapsed"
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
            {/*
             * One control, reading the normal way round. This was an icon
             * button above a second button with its text turned on its side —
             * two ways to do the same thing, and the label unreadable without
             * tilting your head. Someone who has just clicked a region needs to
             * see at a glance where its details went.
             */}
            <Tooltip title="Open region details" placement="left">
              <Button
                variant="text"
                size="small"
                aria-label="Open region details"
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

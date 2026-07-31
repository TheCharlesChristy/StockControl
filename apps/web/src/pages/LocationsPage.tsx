import AddRounded from "@mui/icons-material/AddRounded";
import AccountTreeRounded from "@mui/icons-material/AccountTreeRounded";
import BusinessRounded from "@mui/icons-material/BusinessRounded";
import ArchiveRounded from "@mui/icons-material/ArchiveRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import FitScreenRounded from "@mui/icons-material/FitScreenRounded";
import FolderRounded from "@mui/icons-material/FolderRounded";
import GridOnRounded from "@mui/icons-material/GridOnRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import PanToolRounded from "@mui/icons-material/PanToolRounded";
import PolylineRounded from "@mui/icons-material/PolylineRounded";
import RemoveCircleOutlineRounded from "@mui/icons-material/RemoveCircleOutlineRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import UploadFileRounded from "@mui/icons-material/UploadFileRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import ZoomInRounded from "@mui/icons-material/ZoomInRounded";
import ZoomOutRounded from "@mui/icons-material/ZoomOutRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
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
  ToggleButton,
  ToggleButtonGroup,
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
  type PointerEvent,
  type ReactElement,
} from "react";
import type {
  HierarchyNodeView,
  MapGeometry,
  MapRegionInput,
  MapRegionView,
  MapSnapshot,
} from "@stockcontrol/contracts";

import { ApiError } from "../api/ApiClient";
import { useApi, useResource } from "../api/ApiContext";
import { useAuth } from "../auth/AuthContext";

type EditorMode = "select" | "rectangle" | "polygon" | "pan";
type DraftRegion = Omit<MapRegionView, "id"> & { readonly id?: string };
interface EditorState {
  readonly persisted: MapSnapshot | null;
  readonly draft: MapSnapshot | null;
  readonly selectedRegionId: string | null;
  readonly mode: EditorMode;
  readonly zoom: number;
  readonly drawingPoints: readonly { readonly x: number; readonly y: number }[];
  readonly rectangleStart: { readonly x: number; readonly y: number } | null;
  readonly dirty: boolean;
}
type EditorAction =
  | { readonly type: "load"; readonly map: MapSnapshot }
  | { readonly type: "select"; readonly id: string | null }
  | { readonly type: "mode"; readonly mode: EditorMode }
  | { readonly type: "zoom"; readonly amount: number }
  | { readonly type: "revert" }
  | {
      readonly type: "points";
      readonly points: readonly { readonly x: number; readonly y: number }[];
    }
  | {
      readonly type: "rectangle-start";
      readonly point: { readonly x: number; readonly y: number } | null;
    }
  | { readonly type: "add"; readonly region: DraftRegion }
  | { readonly type: "update"; readonly region: DraftRegion }
  | { readonly type: "saved"; readonly map: MapSnapshot };

const initialEditor: EditorState = {
  persisted: null,
  draft: null,
  selectedRegionId: null,
  mode: "select",
  zoom: 1,
  drawingPoints: [],
  rectangleStart: null,
  dirty: false,
};

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "load")
    return {
      ...state,
      persisted: action.map,
      draft: action.map,
      dirty: false,
      selectedRegionId: null,
      drawingPoints: [],
      rectangleStart: null,
    };
  if (action.type === "saved")
    return {
      ...state,
      persisted: action.map,
      draft: action.map,
      dirty: false,
      drawingPoints: [],
      rectangleStart: null,
    };
  if (action.type === "select") return { ...state, selectedRegionId: action.id };
  if (action.type === "mode")
    return { ...state, mode: action.mode, drawingPoints: [], rectangleStart: null };
  if (action.type === "zoom")
    return { ...state, zoom: Math.max(0.5, Math.min(4, state.zoom + action.amount)) };
  if (action.type === "revert")
    return {
      ...state,
      draft: state.persisted,
      dirty: false,
      selectedRegionId: null,
      drawingPoints: [],
      rectangleStart: null,
    };
  if (action.type === "points") return { ...state, drawingPoints: action.points };
  if (action.type === "rectangle-start") return { ...state, rectangleStart: action.point };
  if (action.type === "add" && state.draft !== null) {
    const id = action.region.id ?? `draft-${String(Date.now())}`;
    return {
      ...state,
      draft: { ...state.draft, regions: [...state.draft.regions, { ...action.region, id }] },
      selectedRegionId: id,
      dirty: true,
      mode: "select",
    };
  }
  if (action.type === "update" && state.draft !== null) {
    const { id: ignoredId, ...changes } = action.region;
    void ignoredId;
    return {
      ...state,
      draft: {
        ...state.draft,
        regions: state.draft.regions.map((region) =>
          region.id === action.region.id ? { ...region, ...changes } : region,
        ),
      },
      dirty: true,
    };
  }
  return state;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const pointFromEvent = (
  event: PointerEvent<SVGSVGElement>,
): { readonly x: number; readonly y: number } => {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
};
const pointFromClient = (
  clientX: number,
  clientY: number,
  canvas: SVGSVGElement,
): { readonly x: number; readonly y: number } => {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp((clientX - bounds.left) / bounds.width),
    y: clamp((clientY - bounds.top) / bounds.height),
  };
};
const geometryString = (geometry: MapGeometry): string =>
  geometry.kind === "Rectangle"
    ? `${String(geometry.x * 100)},${String(geometry.y * 100)} ${String(geometry.width * 100)},${String(geometry.height * 100)}`
    : geometry.points.map((point) => `${String(point.x * 100)},${String(point.y * 100)}`).join(" ");
const moveGeometry = (geometry: MapGeometry, dx: number, dy: number): MapGeometry => {
  if (geometry.kind === "Rectangle")
    return {
      ...geometry,
      x: Math.min(1 - geometry.width, Math.max(0, geometry.x + dx)),
      y: Math.min(1 - geometry.height, Math.max(0, geometry.y + dy)),
    };
  return {
    ...geometry,
    points: geometry.points.map((point) => ({ x: clamp(point.x + dx), y: clamp(point.y + dy) })),
  };
};
const resizeRectangle = (
  geometry: Extract<MapGeometry, { readonly kind: "Rectangle" }>,
  handle: "nw" | "ne" | "sw" | "se",
  point: { readonly x: number; readonly y: number },
): MapGeometry => {
  const right = geometry.x + geometry.width;
  const bottom = geometry.y + geometry.height;
  const left = handle.includes("w") ? Math.min(point.x, right - 0.02) : geometry.x;
  const top = handle.includes("n") ? Math.min(point.y, bottom - 0.02) : geometry.y;
  const nextRight = handle.includes("e") ? Math.max(point.x, left + 0.02) : right;
  const nextBottom = handle.includes("s") ? Math.max(point.y, top + 0.02) : bottom;
  const nextLeft = clamp(left);
  const boundedTop = clamp(top);
  const boundedRight = Math.min(1, Math.max(nextLeft + 0.02, nextRight));
  const boundedBottom = Math.min(1, Math.max(boundedTop + 0.02, nextBottom));
  return {
    kind: "Rectangle",
    x: nextLeft,
    y: boundedTop,
    width: boundedRight - nextLeft,
    height: boundedBottom - boundedTop,
  };
};

type CanvasInteraction =
  | {
      readonly kind: "move";
      readonly regionId: string;
      readonly startPoint: { readonly x: number; readonly y: number };
      readonly geometry: MapGeometry;
    }
  | {
      readonly kind: "resize";
      readonly regionId: string;
      readonly handle: "nw" | "ne" | "sw" | "se";
      readonly geometry: Extract<MapGeometry, { readonly kind: "Rectangle" }>;
    };
const toInputs = (map: MapSnapshot): readonly MapRegionInput[] =>
  map.regions.map((region) => ({
    ...(region.id.startsWith("draft-") ? {} : { id: region.id }),
    displayName: region.displayName,
    hierarchyNodeId: region.hierarchyNodeId,
    parentRegionId: region.parentRegionId,
    geometry: region.geometry,
    zOrder: region.zOrder,
    searchAliases: region.searchAliases,
    status: region.status,
  }));

const flattenHierarchy = (
  nodes: readonly MapSnapshot["hierarchy"][number][],
): readonly MapSnapshot["hierarchy"][number][] =>
  nodes.flatMap((node) => [node, ...flattenHierarchy(node.children)]);

const fileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.split(",", 2)[1] ?? "");
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("File could not be read.")),
    );
    reader.readAsDataURL(file);
  });

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} onClick={onClick} size="small">
        {children}
      </IconButton>
    </Tooltip>
  );
}

function HierarchyIcon({
  nodeKind,
}: {
  readonly nodeKind: HierarchyNodeView["nodeKind"];
}): ReactElement {
  if (nodeKind === "Branch") return <AccountTreeRounded fontSize="small" />;
  if (nodeKind === "Building") return <BusinessRounded fontSize="small" />;
  return <FolderRounded fontSize="small" />;
}

function StockStatusIcon({ status }: { readonly status: string }): ReactElement {
  if (status === "Available") return <CheckCircleRounded fontSize="small" />;
  if (status === "LowStock") return <WarningAmberRounded fontSize="small" />;
  if (status === "Archived") return <ArchiveRounded fontSize="small" />;
  return <RemoveCircleOutlineRounded fontSize="small" />;
}

const modeLabel = (mode: EditorMode): string => {
  if (mode === "rectangle") return "Rectangle tool";
  if (mode === "polygon") return "Polygon tool";
  if (mode === "pan") return "Pan tool";
  return "Select tool";
};

const geometrySummary = (geometry: MapGeometry): string =>
  geometry.kind === "Rectangle"
    ? `Rectangle · ${String(Math.round(geometry.width * 100))}% × ${String(Math.round(geometry.height * 100))}%`
    : `Polygon · ${String(geometry.points.length)} points`;

export function LocationsPage(): ReactElement {
  const api = useApi();
  const { user } = useAuth();
  const canEdit = user?.role === "Admin";
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, initialEditor);
  const [query, setQuery] = useState("");
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeCode, setNewNodeCode] = useState("");
  const [newNodeKind, setNewNodeKind] = useState<
    "Building" | "Area" | "Aisle" | "Shelf" | "Bin" | "CustomSection"
  >("Area");
  const [newNodeParentId, setNewNodeParentId] = useState<string | null>(null);
  const [selectedHierarchyNodeId, setSelectedHierarchyNodeId] = useState<string | null>(null);
  const [hierarchyName, setHierarchyName] = useState("");
  const [collapsedHierarchyIds, setCollapsedHierarchyIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const interaction = useRef<CanvasInteraction | null>(null);
  const locations = useResource(
    useCallback(
      (signal: AbortSignal) => Promise.all([api.getLocationTree(signal), api.listMaps(signal)]),
      [api],
    ),
  );
  const buildings = locations.data?.[0].buildings ?? [];
  const maps = useMemo(() => locations.data?.[1] ?? [], [locations.data]);
  const selectedBuildingId = buildingId ?? buildings[0]?.id ?? null;
  const persistedMapId = editor.persisted === null ? null : editor.persisted.id;
  const persistedRevision = editor.persisted === null ? -1 : editor.persisted.revision;
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
        query.trim().length < 1 ? Promise.resolve([]) : api.searchLocations(query, signal),
      [api, query],
    ),
  );

  useEffect(() => {
    if (
      mapResource.data !== undefined &&
      (mapResource.data.id !== persistedMapId || mapResource.data.revision !== persistedRevision)
    )
      dispatch({ type: "load", map: mapResource.data });
  }, [mapResource.data, persistedMapId, persistedRevision]);
  useEffect(() => {
    if (
      focusedId !== null &&
      editor.draft !== null &&
      editor.draft.regions.some((region) => region.id === focusedId)
    )
      dispatch({ type: "select", id: focusedId });
  }, [editor.draft, focusedId]);
  const selectedRegion =
    editor.draft?.regions.find((region) => region.id === editor.selectedRegionId) ?? null;
  const showInspector = inspectorOpen || selectedRegion !== null;
  const hierarchyOptions =
    editor.draft !== null
      ? flattenHierarchy(editor.draft.hierarchy)
      : locations.data === undefined
        ? []
        : flattenHierarchy([locations.data[0].root]);
  const branchId = locations.data?.[0].root.id ?? null;
  const defaultParentId =
    newNodeParentId ?? (newNodeKind === "Building" ? branchId : selectedBuildingId);
  const selectedHierarchyNode = hierarchyOptions.find(
    (node) => node.id === selectedHierarchyNodeId,
  );
  const renderHierarchy = (
    nodes: readonly HierarchyNodeView[],
    depth = 0,
  ): readonly ReactElement[] =>
    nodes.flatMap((node) => [
      <ListItemButton
        key={node.id}
        selected={selectedHierarchyNodeId === node.id}
        aria-selected={selectedHierarchyNodeId === node.id}
        sx={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "20px 24px minmax(0, 1fr)",
          alignItems: "center",
          gap: 0.5,
          minHeight: 48,
          pl: 1 + depth * 2,
          pr: 1,
          borderRadius: 1,
          "&:hover": { bgcolor: "#F3F6FB" },
          "&.Mui-selected": {
            bgcolor: "#E8EEF9",
            boxShadow: "inset 3px 0 0 #00309D",
            "&:hover": { bgcolor: "#E8EEF9" },
          },
        }}
        onClick={() => {
          setSelectedHierarchyNodeId(node.id);
          setHierarchyName(node.name);
          if (node.nodeKind === "Building") setBuildingId(node.id);
        }}
      >
        {node.children.length > 0 ? (
          <IconButton
            size="small"
            aria-label={`${collapsedHierarchyIds.has(node.id) ? "Expand" : "Collapse"} ${node.name}`}
            aria-expanded={!collapsedHierarchyIds.has(node.id)}
            onClick={(event) => {
              event.stopPropagation();
              setCollapsedHierarchyIds((current) => {
                const next = new Set(current);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
            }}
            sx={{ p: 0, width: 20, height: 20 }}
          >
            {collapsedHierarchyIds.has(node.id) ? (
              <ChevronRightRounded fontSize="small" />
            ) : (
              <ExpandMoreRounded fontSize="small" />
            )}
          </IconButton>
        ) : (
          <Box sx={{ width: 20, height: 20 }} />
        )}
        <Box sx={{ display: "grid", placeItems: "center", color: "primary.main" }}>
          <HierarchyIcon nodeKind={node.nodeKind} />
        </Box>
        <ListItemText
          primary={node.name}
          secondary={node.code}
          sx={{ minWidth: 0, my: 0 }}
          slotProps={{
            primary: {
              noWrap: true,
              fontSize: "0.84rem",
              fontWeight: 700,
              color: "#17243B",
            },
            secondary: {
              noWrap: true,
              fontSize: "0.72rem",
              color: "#667085",
            },
          }}
        />
      </ListItemButton>,
      ...(collapsedHierarchyIds.has(node.id) ? [] : renderHierarchy(node.children, depth + 1)),
    ]);
  const buildingMap = maps.find((map) => map.buildingId === selectedBuildingId);

  const save = async (): Promise<void> => {
    if (!canEdit || editor.draft === null) return;
    setSaveMessage(null);
    setConflict(false);
    try {
      const saved = await api.saveMap(editor.draft.id, {
        expectedRevision: editor.draft.revision,
        regions: toInputs(editor.draft),
      });
      dispatch({ type: "saved", map: saved });
      setSaveMessage("Map saved");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else setSaveMessage(error instanceof Error ? error.message : "Map could not be saved");
    }
  };

  const uploadBackground = async (file: File): Promise<void> => {
    if (!canEdit || editor.draft === null) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setSaveMessage("Choose a PNG or JPEG floor plan.");
      return;
    }
    setSaveMessage(null);
    setConflict(false);
    try {
      const saved = await api.uploadFloorPlan(editor.draft.id, {
        expectedRevision: editor.draft.revision,
        regions: toInputs(editor.draft),
        originalFileName: file.name,
        mediaType: file.type,
        contentBase64: await fileAsBase64(file),
      });
      dispatch({ type: "saved", map: saved });
      setSaveMessage("Floor plan uploaded and map saved");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else
        setSaveMessage(error instanceof Error ? error.message : "Floor plan could not be uploaded");
    }
  };

  const createHierarchyNode = async (): Promise<void> => {
    if (
      !canEdit ||
      defaultParentId === null ||
      newNodeName.trim() === "" ||
      newNodeCode.trim() === ""
    ) {
      setSaveMessage("Enter a code, name, and parent location.");
      return;
    }
    try {
      const created = await api.createHierarchyNode({
        code: newNodeCode,
        name: newNodeName,
        nodeKind: newNodeKind,
        operationalKind: newNodeKind === "Building" ? "Container" : "Storage",
        parentId: defaultParentId,
      });
      setNewNodeCode("");
      setNewNodeName("");
      if (created.nodeKind === "Building") {
        setBuildingId(created.id);
        setSelectedHierarchyNodeId(created.id);
        setHierarchyName(created.name);
      }
      setSaveMessage("Hierarchy node created");
      refreshLocations();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Location could not be created");
    }
  };

  const refreshLocations = (): void => {
    locations.reload();
    mapResource.reload();
  };

  const saveHierarchyName = async (): Promise<void> => {
    if (!canEdit || selectedHierarchyNode === undefined) return;
    try {
      await api.renameLocation(selectedHierarchyNode.id, hierarchyName);
      setSaveMessage("Location renamed");
      refreshLocations();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Location could not be renamed");
    }
  };

  const moveHierarchyNode = async (parentId: string): Promise<void> => {
    if (!canEdit || selectedHierarchyNode === undefined || parentId === "none") return;
    try {
      await api.moveLocation(selectedHierarchyNode.id, parentId);
      setSaveMessage("Location moved");
      refreshLocations();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Location could not be moved");
    }
  };

  const archiveHierarchyNode = async (): Promise<void> => {
    if (!canEdit || selectedHierarchyNode === undefined) return;
    if (!window.confirm(`Archive ${selectedHierarchyNode.name}?`)) return;
    try {
      await api.archiveLocation(selectedHierarchyNode.id);
      setSelectedHierarchyNodeId(null);
      setSaveMessage("Location archived");
      refreshLocations();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Location could not be archived");
    }
  };

  const deleteHierarchyNode = async (): Promise<void> => {
    if (!canEdit || selectedHierarchyNode === undefined) return;
    if (!window.confirm(`Delete ${selectedHierarchyNode.name}?`)) return;
    try {
      await api.deleteLocation(selectedHierarchyNode.id);
      if (selectedHierarchyNode.nodeKind === "Building") setBuildingId(null);
      setSelectedHierarchyNodeId(null);
      setSaveMessage("Location deleted");
      refreshLocations();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Location could not be deleted");
    }
  };

  const startBuildingCreation = (): void => {
    setNewNodeKind("Building");
    setNewNodeParentId(branchId);
    document.getElementById("new-location-code")?.focus();
  };

  const onCanvasPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (!canEdit || editor.draft === null) return;
    if (editor.mode === "polygon")
      dispatch({ type: "points", points: [...editor.drawingPoints, pointFromEvent(event)] });
    if (editor.mode === "rectangle")
      dispatch({ type: "rectangle-start", point: pointFromEvent(event) });
  };
  const finishPolygon = (): void => {
    if (editor.drawingPoints.length < 3) return;
    dispatch({
      type: "add",
      region: {
        id: `draft-${String(Date.now())}`,
        displayName: "New region",
        hierarchyNodeId: editor.draft?.buildingId ?? "",
        parentRegionId: null,
        geometry: { kind: "Polygon", points: editor.drawingPoints },
        zOrder: (editor.draft?.regions.length ?? 0) + 1,
        searchAliases: [],
        status: "Active",
        stock: {
          status: "OutOfStock",
          colour: "#D32F2F",
          text: "Out of stock",
          icon: "remove-circle",
          itemCount: 0,
          quantity: "0",
        },
      },
    });
  };
  const drawRectangle = (event: PointerEvent<SVGSVGElement>): void => {
    if (
      !canEdit ||
      editor.mode !== "rectangle" ||
      editor.draft === null ||
      editor.rectangleStart === null
    )
      return;
    const point = pointFromEvent(event);
    const start = editor.rectangleStart;
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const right = Math.max(start.x, point.x);
    const bottom = Math.max(start.y, point.y);
    const boundedX = Math.min(x, 0.98);
    const boundedY = Math.min(y, 0.98);
    dispatch({
      type: "add",
      region: {
        id: `draft-${String(Date.now())}`,
        displayName: "New region",
        hierarchyNodeId: editor.draft.buildingId,
        parentRegionId: null,
        geometry: {
          kind: "Rectangle",
          x: boundedX,
          y: boundedY,
          width: Math.max(0.02, Math.min(1, right) - boundedX),
          height: Math.max(0.02, Math.min(1, bottom) - boundedY),
        },
        zOrder: editor.draft.regions.length + 1,
        searchAliases: [],
        status: "Active",
        stock: {
          status: "OutOfStock",
          colour: "#D32F2F",
          text: "Out of stock",
          icon: "remove-circle",
          itemCount: 0,
          quantity: "0",
        },
      },
    });
  };
  const onCanvasPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const current = interaction.current;
    if (!canEdit || current === null || canvasRef.current === null) return;
    const point = pointFromClient(event.clientX, event.clientY, canvasRef.current);
    const region = editor.draft?.regions.find((candidate) => candidate.id === current.regionId);
    if (region === undefined) return;
    const geometry =
      current.kind === "move"
        ? moveGeometry(
            current.geometry,
            point.x - current.startPoint.x,
            point.y - current.startPoint.y,
          )
        : resizeRectangle(current.geometry, current.handle, point);
    dispatch({ type: "update", region: { ...region, geometry } });
  };
  const onCanvasPointerUp = (): void => {
    interaction.current = null;
    if (editor.mode === "rectangle") dispatch({ type: "rectangle-start", point: null });
  };
  const beginRegionMove = (event: PointerEvent<SVGElement>, region: MapRegionView): void => {
    event.stopPropagation();
    dispatch({ type: "select", id: region.id });
    if (!canEdit || editor.mode !== "select" || canvasRef.current === null) return;
    interaction.current = {
      kind: "move",
      regionId: region.id,
      startPoint: pointFromClient(event.clientX, event.clientY, canvasRef.current),
      geometry: region.geometry,
    };
  };
  const beginResize = (
    event: PointerEvent<SVGCircleElement>,
    region: MapRegionView,
    handle: "nw" | "ne" | "sw" | "se",
  ): void => {
    event.stopPropagation();
    if (!canEdit || editor.mode !== "select" || region.geometry.kind !== "Rectangle") return;
    dispatch({ type: "select", id: region.id });
    interaction.current = {
      kind: "resize",
      regionId: region.id,
      handle,
      geometry: region.geometry,
    };
  };
  const onRegionKeyDown = (event: React.KeyboardEvent<SVGElement>, region: MapRegionView): void => {
    if (!canEdit) return;
    const step = event.shiftKey ? 0.02 : 0.005;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    dispatch({
      type: "update",
      region: { ...region, geometry: moveGeometry(region.geometry, dx, dy) },
    });
  };

  const legend = useMemo(
    () =>
      [
        ["#2E7D32", "Available", <CheckCircleRounded fontSize="inherit" />],
        ["#ED6C02", "Low stock", <WarningAmberRounded fontSize="inherit" />],
        ["#D32F2F", "Out of stock", <RemoveCircleOutlineRounded fontSize="inherit" />],
        ["#757575", "Archived", <ArchiveRounded fontSize="inherit" />],
      ] as const,
    [],
  );

  const selectedBuilding = buildings.find((building) => building.id === selectedBuildingId);

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
              Locations / {selectedBuilding?.name ?? "Building"}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography
                variant="h1"
                component="h1"
                sx={{ fontSize: { xs: "1.6rem", sm: "2rem" }, lineHeight: 1.15 }}
              >
                {selectedBuilding?.name ?? "Locations"}
              </Typography>
              {selectedBuilding !== undefined && (
                <Chip label="Building" size="small" variant="outlined" />
              )}
            </Stack>
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
                onChange={(event) => setBuildingId(event.target.value)}
              >
                {buildings.map((building) => (
                  <MenuItem key={building.id} value={building.id}>
                    {building.name} · {building.code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddRounded />}
              onClick={startBuildingCreation}
              disabled={!canEdit || branchId === null}
            >
              Add building
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<MapRounded />}
              onClick={() => canvasRef.current?.focus()}
              disabled={editor.draft === null}
            >
              Edit map
            </Button>
          </Stack>
        </Stack>
        {(conflict || saveMessage !== null) && (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {conflict && (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" onClick={() => mapResource.reload()}>
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
                severity={saveMessage === "Map saved" ? "success" : "error"}
                onClose={() => setSaveMessage(null)}
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
          borderColor: "#D9E0E9",
          borderRadius: 1.5,
          bgcolor: "background.paper",
        }}
      >
        <Box
          component="aside"
          aria-label="Location hierarchy and search"
          sx={{
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            minWidth: 0,
            minHeight: { xs: 420, lg: 0 },
            overflow: "hidden",
            borderRight: { lg: "1px solid #D9E0E9" },
          }}
        >
          <Box sx={{ p: 1.5, borderBottom: "1px solid #E2E7EE" }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 1 }}
            >
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search locations…"
              size="small"
              inputProps={{ "aria-label": "Search locations" }}
              InputProps={{
                startAdornment: (
                  <SearchRounded fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />
                ),
              }}
            />
          </Box>
          <Box sx={{ minHeight: 0, overflowY: "auto", p: 1.25 }}>
            {searchResource.data !== undefined && query.trim().length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
                  Search results
                </Typography>
                <List dense disablePadding aria-label="Search results">
                  {searchResource.data.map((result) => (
                    <ListItemButton
                      key={`${result.mapId ?? "location"}-${result.location.id}`}
                      selected={focusedId === result.regionId}
                      onClick={() => {
                        setFocusedId(result.regionId);
                        if (
                          result.mapId !== editor.draft?.id &&
                          result.location.buildingId !== null
                        )
                          setBuildingId(result.location.buildingId);
                      }}
                      sx={{ minHeight: 44 }}
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
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ px: 1 }}
            >
              <Typography variant="overline" color="text.secondary">
                Hierarchy
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {buildings.length} building{buildings.length === 1 ? "" : "s"}
              </Typography>
            </Stack>
            {buildings.length === 0 ? (
              <Typography color="text.secondary" sx={{ px: 1, py: 2 }}>
                No buildings configured yet.
              </Typography>
            ) : (
              <List dense disablePadding aria-label="Location hierarchy">
                {locations.data === undefined ? [] : renderHierarchy([locations.data[0].root])}
              </List>
            )}
            {canEdit && (
              <Stack spacing={1} sx={{ mt: 2, pt: 2, px: 1, borderTop: "1px solid #E2E7EE" }}>
                <Typography variant="overline" color="text.secondary">
                  Add hierarchy node
                </Typography>
                <TextField
                  id="new-location-code"
                  size="small"
                  label="Code"
                  value={newNodeCode}
                  onChange={(event) => setNewNodeCode(event.target.value)}
                />
                <TextField
                  size="small"
                  label="Name"
                  value={newNodeName}
                  onChange={(event) => setNewNodeName(event.target.value)}
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
                    {["Building", "Area", "Aisle", "Shelf", "Bin", "CustomSection"].map((kind) => (
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
                    value={defaultParentId ?? ""}
                    onChange={(event) => setNewNodeParentId(event.target.value)}
                  >
                    {hierarchyOptions
                      .filter((node) =>
                        newNodeKind === "Building"
                          ? node.nodeKind === "Branch"
                          : node.nodeKind !== "Bin" && node.nodeKind !== "Branch",
                      )
                      .map((node) => (
                        <MenuItem key={node.id} value={node.id}>
                          {node.name} · {node.code}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
                <Button
                  variant="outlined"
                  startIcon={<AddRounded />}
                  onClick={() => void createHierarchyNode()}
                >
                  Add location
                </Button>
                {selectedHierarchyNode !== undefined &&
                  selectedHierarchyNode.nodeKind !== "Branch" && (
                    <Stack spacing={1} sx={{ pt: 1.5, borderTop: "1px solid #E2E7EE" }}>
                      <Typography variant="overline" color="text.secondary">
                        Edit selected location
                      </Typography>
                      <TextField
                        size="small"
                        label="Name"
                        value={hierarchyName}
                        onChange={(event) => setHierarchyName(event.target.value)}
                      />
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => void saveHierarchyName()}
                        >
                          Rename
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          startIcon={<ArchiveRounded />}
                          onClick={() => void archiveHierarchyNode()}
                        >
                          Archive
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          startIcon={<DeleteOutlineRounded />}
                          onClick={() => void deleteHierarchyNode()}
                          disabled={selectedHierarchyNode.status === "Archived"}
                        >
                          Delete
                        </Button>
                      </Stack>
                      <FormControl size="small">
                        <InputLabel id="move-location-parent-label">Move under</InputLabel>
                        <Select
                          labelId="move-location-parent-label"
                          label="Move under"
                          value={selectedHierarchyNode.parentId ?? "none"}
                          onChange={(event) => void moveHierarchyNode(event.target.value)}
                        >
                          <MenuItem value="none">No parent</MenuItem>
                          {hierarchyOptions
                            .filter(
                              (node) =>
                                node.id !== selectedHierarchyNode.id && node.status === "Active",
                            )
                            .map((node) => (
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
        <Box
          component="section"
          aria-label="Building map"
          sx={{
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            minWidth: 0,
            minHeight: { xs: 600, lg: 0 },
            overflow: "hidden",
          }}
        >
          <Box
            component="nav"
            aria-label="Map toolbar"
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              minHeight: 48,
              px: 1.25,
              py: 0.75,
              borderBottom: "1px solid #D9E0E9",
              bgcolor: "#FFFFFF",
              flexWrap: "wrap",
            }}
          >
            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.25,
                  pr: 1,
                  mr: 0.5,
                  borderRight: "1px solid #E2E7EE",
                }}
              >
                {canEdit ? (
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={editor.mode === "select" || editor.mode === "pan" ? editor.mode : null}
                    onChange={(_, value: EditorMode | null) => {
                      if (value !== null) dispatch({ type: "mode", mode: value });
                    }}
                    aria-label="Navigation tools"
                    sx={{ height: 34 }}
                  >
                    <ToggleButton value="select" aria-label="Select mode" title="Select">
                      <EditRounded fontSize="small" />
                    </ToggleButton>
                    <ToggleButton value="pan" aria-label="Pan map" title="Pan">
                      <PanToolRounded fontSize="small" />
                    </ToggleButton>
                  </ToggleButtonGroup>
                ) : (
                  <Chip size="small" label="View only" variant="outlined" />
                )}
              </Box>
              {canEdit && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.25,
                    pr: 1,
                    mr: 0.5,
                    borderRight: "1px solid #E2E7EE",
                  }}
                >
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={
                      editor.mode === "rectangle" || editor.mode === "polygon" ? editor.mode : null
                    }
                    onChange={(_, value: EditorMode | null) => {
                      if (value !== null) dispatch({ type: "mode", mode: value });
                    }}
                    aria-label="Drawing tools"
                    sx={{ height: 34 }}
                  >
                    <ToggleButton value="rectangle" aria-label="Draw rectangle" title="Rectangle">
                      <Box
                        component="span"
                        sx={{ width: 16, height: 12, border: "2px solid currentColor" }}
                      />
                    </ToggleButton>
                    <ToggleButton value="polygon" aria-label="Draw polygon" title="Polygon">
                      <PolylineRounded fontSize="small" />
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              )}
              <Stack direction="row" spacing={0.25} alignItems="center">
                <ToolbarButton
                  label="Zoom out"
                  onClick={() => dispatch({ type: "zoom", amount: -0.25 })}
                >
                  <ZoomOutRounded fontSize="small" />
                </ToolbarButton>
                <Typography
                  variant="caption"
                  sx={{
                    minWidth: 42,
                    textAlign: "center",
                    fontWeight: 800,
                    color: "text.secondary",
                  }}
                >
                  {String(Math.round(editor.zoom * 100))}%
                </Typography>
                <ToolbarButton
                  label="Zoom in"
                  onClick={() => dispatch({ type: "zoom", amount: 0.25 })}
                >
                  <ZoomInRounded fontSize="small" />
                </ToolbarButton>
                <ToolbarButton
                  label="Fit map to canvas"
                  onClick={() => dispatch({ type: "zoom", amount: 1 - editor.zoom })}
                >
                  <FitScreenRounded fontSize="small" />
                </ToolbarButton>
              </Stack>
              <Chip
                size="small"
                icon={<GridOnRounded />}
                label={`Editing map · ${modeLabel(canEdit ? editor.mode : "select")}`}
                variant="outlined"
                sx={{ display: { xs: "none", xl: "inline-flex" } }}
              />
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center">
              {editor.dirty && <Chip size="small" label="Unsaved changes" color="warning" />}
              {canEdit && (
                <>
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    accept="image/png,image/jpeg"
                    aria-label="Upload floor plan"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file !== undefined) void uploadBackground(file);
                    }}
                  />
                  {editor.draft !== null && (
                    <>
                      <Button
                        size="small"
                        startIcon={<UploadFileRounded />}
                        onClick={() => fileInput.current?.click()}
                        sx={{ minHeight: 34, px: 1.25, display: { xs: "none", sm: "inline-flex" } }}
                      >
                        Upload floor plan
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => void save()}
                        sx={{ minHeight: 34, px: 1.5 }}
                      >
                        Save
                      </Button>
                      <Button
                        size="small"
                        onClick={() => dispatch({ type: "revert" })}
                        disabled={!editor.dirty}
                        sx={{ minHeight: 34, px: 1.25, display: { xs: "none", sm: "inline-flex" } }}
                      >
                        Revert
                      </Button>
                    </>
                  )}
                </>
              )}
            </Stack>
          </Box>
          <Box
            sx={{
              position: "relative",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              bgcolor: "#F8FAFC",
              backgroundImage:
                "linear-gradient(#DFE5EE 1px, transparent 1px), linear-gradient(90deg, #DFE5EE 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            {mapResource.status === "error" &&
            buildingMap === undefined &&
            canEdit &&
            selectedBuildingId !== null ? (
              <Stack
                alignItems="center"
                justifyContent="center"
                spacing={1.25}
                sx={{ position: "absolute", inset: 0, p: 4, textAlign: "center" }}
              >
                <Box
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    color: "primary.main",
                    bgcolor: "#E8EEF9",
                  }}
                >
                  <MapRounded />
                </Box>
                <Typography variant="h3" component="h2">
                  No storage map yet
                </Typography>
                <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
                  Create a blank map and draw storage regions for this building.
                </Typography>
                <Button
                  startIcon={<AddRounded />}
                  variant="contained"
                  onClick={() =>
                    void api.createMap(selectedBuildingId).then((map) => {
                      dispatch({ type: "load", map });
                      locations.reload();
                    })
                  }
                >
                  Create blank map
                </Button>
              </Stack>
            ) : editor.draft === null ? (
              <Typography
                color="text.secondary"
                sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
              >
                Loading map…
              </Typography>
            ) : (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                }}
              >
                <svg
                  ref={canvasRef}
                  viewBox="0 0 100 100"
                  role="application"
                  aria-label={`${editor.draft.building.name} map`}
                  tabIndex={0}
                  onPointerDown={onCanvasPointerDown}
                  onPointerMove={onCanvasPointerMove}
                  onPointerUp={(event) => {
                    drawRectangle(event);
                    onCanvasPointerUp();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && editor.mode === "polygon") finishPolygon();
                    if (event.key === "Escape") dispatch({ type: "points", points: [] });
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    transform: `scale(${String(editor.zoom)})`,
                    transformOrigin: "center",
                  }}
                >
                  {editor.draft.background.kind === "FloorPlan" &&
                    editor.draft.background.downloadPath !== undefined && (
                      <image
                        href={editor.draft.background.downloadPath}
                        x="0"
                        y="0"
                        width="100"
                        height="100"
                        preserveAspectRatio="xMidYMid slice"
                        opacity="0.28"
                        aria-label={editor.draft.background.originalFileName ?? "Floor plan"}
                      />
                    )}
                  {editor.drawingPoints.length > 1 && (
                    <polyline
                      points={geometryString({ kind: "Polygon", points: editor.drawingPoints })}
                      fill="none"
                      stroke="#00309D"
                      strokeWidth="0.8"
                      strokeDasharray="2 1"
                    />
                  )}
                  {editor.draft.regions.map((region) => {
                    const selected =
                      focusedId === region.id || editor.selectedRegionId === region.id;
                    return (
                      <g
                        key={region.id}
                        data-region-id={region.id}
                        opacity={region.status === "Archived" ? 0.42 : 0.82}
                      >
                        {region.geometry.kind === "Rectangle" ? (
                          <rect
                            x={region.geometry.x * 100}
                            y={region.geometry.y * 100}
                            width={region.geometry.width * 100}
                            height={region.geometry.height * 100}
                            fill={region.stock.colour}
                            stroke={selected ? "#071B3A" : "#FFFFFF"}
                            strokeWidth={selected ? 1.4 : 0.6}
                            onPointerDown={(event) => beginRegionMove(event, region)}
                            onKeyDown={(event) => onRegionKeyDown(event, region)}
                            tabIndex={0}
                            role="button"
                            aria-label={`${region.displayName}, ${region.stock.text}`}
                          />
                        ) : (
                          <polygon
                            points={geometryString(region.geometry)}
                            fill={region.stock.colour}
                            stroke={selected ? "#071B3A" : "#FFFFFF"}
                            strokeWidth={selected ? 1.4 : 0.6}
                            onPointerDown={(event) => beginRegionMove(event, region)}
                            onKeyDown={(event) => onRegionKeyDown(event, region)}
                            tabIndex={0}
                            role="button"
                            aria-label={`${region.displayName}, ${region.stock.text}`}
                          />
                        )}
                        {canEdit && selected && region.geometry.kind === "Rectangle" && (
                          <>
                            {(
                              [
                                ["nw", region.geometry.x, region.geometry.y],
                                [
                                  "ne",
                                  region.geometry.x + region.geometry.width,
                                  region.geometry.y,
                                ],
                                [
                                  "sw",
                                  region.geometry.x,
                                  region.geometry.y + region.geometry.height,
                                ],
                                [
                                  "se",
                                  region.geometry.x + region.geometry.width,
                                  region.geometry.y + region.geometry.height,
                                ],
                              ] as const
                            ).map(([handle, x, y]) => (
                              <circle
                                key={handle}
                                cx={x * 100}
                                cy={y * 100}
                                r="1.4"
                                fill="#fff"
                                stroke="#071B3A"
                                strokeWidth="0.5"
                                tabIndex={0}
                                role="button"
                                aria-label={`Resize ${region.displayName} ${handle}`}
                                onPointerDown={(event) => beginResize(event, region, handle)}
                              />
                            ))}
                          </>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </Box>
            )}
            {editor.mode === "polygon" && editor.drawingPoints.length > 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  position: "absolute",
                  left: 16,
                  bottom: 16,
                  px: 1.25,
                  py: 0.75,
                  border: "1px solid #D8DEE8",
                  borderRadius: 1,
                  bgcolor: "rgba(255,255,255,0.92)",
                  boxShadow: "0 4px 14px rgba(19,36,65,0.08)",
                }}
              >
                Click to add points. Press Enter to complete or Escape to cancel.
              </Typography>
            )}
            {editor.draft !== null && (
              <Stack
                direction="row"
                spacing={1.5}
                flexWrap="wrap"
                aria-label="Map status legend"
                sx={{
                  position: "absolute",
                  right: 16,
                  bottom: 16,
                  maxWidth: "calc(100% - 32px)",
                  px: 1.25,
                  py: 0.75,
                  border: "1px solid #D8DEE8",
                  borderRadius: 1,
                  bgcolor: "rgba(255,255,255,0.92)",
                  boxShadow: "0 4px 14px rgba(19,36,65,0.08)",
                  backdropFilter: "blur(6px)",
                  fontSize: "0.75rem",
                }}
              >
                {legend.map(([colour, label, icon]) => (
                  <Stack key={label} direction="row" spacing={0.5} alignItems="center">
                    <Box
                      aria-hidden="true"
                      sx={{ width: 8, height: 8, bgcolor: colour, borderRadius: "50%" }}
                    />
                    <Box sx={{ display: "grid", placeItems: "center", color: colour }}>{icon}</Box>
                    <Typography variant="caption">{label}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        </Box>
        {showInspector ? (
          <Box
            component="aside"
            aria-label="Region details"
            sx={{
              minWidth: 0,
              minHeight: { xs: 360, lg: 0 },
              overflowY: "auto",
              borderLeft: { lg: "1px solid #D9E0E9" },
            }}
          >
            <Box sx={{ p: 1.75 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="start">
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Region details
                  </Typography>
                  {selectedRegion !== null && (
                    <>
                      <Typography variant="h3" component="h2" sx={{ mt: 0.25 }}>
                        {selectedRegion.displayName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                        {hierarchyOptions.find((node) => node.id === selectedRegion.hierarchyNodeId)
                          ?.code ?? selectedRegion.hierarchyNodeId}
                      </Typography>
                    </>
                  )}
                </Box>
                <IconButton
                  size="small"
                  aria-label="Close region details"
                  onClick={() => {
                    dispatch({ type: "select", id: null });
                    setInspectorOpen(false);
                  }}
                >
                  <CloseRounded fontSize="small" />
                </IconButton>
              </Stack>
              {selectedRegion === null ? (
                <Stack spacing={1.25} sx={{ pt: 7, pb: 5 }}>
                  <MapRounded color="primary" sx={{ fontSize: 36 }} />
                  <Typography sx={{ fontWeight: 800 }}>Nothing selected</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Select a region on the map to view its assigned location, stock status, item
                    quantities and dimensions.
                  </Typography>
                </Stack>
              ) : (
                <Stack spacing={1.75} sx={{ mt: 1.5 }}>
                  <Box sx={{ pb: 1.75, borderBottom: "1px solid #E2E7EE" }}>
                    <Typography variant="overline" color="text.secondary">
                      Stock status
                    </Typography>
                    <Chip
                      icon={<StockStatusIcon status={selectedRegion.stock.status} />}
                      label={selectedRegion.stock.text}
                      sx={{
                        mt: 0.75,
                        alignSelf: "start",
                        bgcolor: selectedRegion.stock.colour,
                        color: "#fff",
                        "& .MuiChip-icon": { color: "inherit" },
                      }}
                    />
                    <Stack direction="row" spacing={2.5} sx={{ mt: 1.5 }}>
                      <Box>
                        <Typography variant="h4">{selectedRegion.stock.itemCount}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          item types
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="h4">{selectedRegion.stock.quantity}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          total units
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>
                  <Box sx={{ pb: 1.75, borderBottom: "1px solid #E2E7EE" }}>
                    <Typography variant="overline" color="text.secondary">
                      Mapped area
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }}>
                      {geometrySummary(selectedRegion.geometry)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Use the selected region handles or arrow keys to adjust its position.
                    </Typography>
                  </Box>
                  {canEdit && (
                    <Stack spacing={1.25}>
                      <Typography variant="overline" color="text.secondary">
                        Properties
                      </Typography>
                      <TextField
                        fullWidth
                        label="Region name"
                        size="small"
                        value={selectedRegion.displayName}
                        onChange={(event) =>
                          dispatch({
                            type: "update",
                            region: { ...selectedRegion, displayName: event.target.value },
                          })
                        }
                      />
                      <FormControl fullWidth size="small">
                        <InputLabel id="region-location-label">Location assignment</InputLabel>
                        <Select
                          labelId="region-location-label"
                          label="Location assignment"
                          value={selectedRegion.hierarchyNodeId}
                          onChange={(event) =>
                            dispatch({
                              type: "update",
                              region: { ...selectedRegion, hierarchyNodeId: event.target.value },
                            })
                          }
                        >
                          {hierarchyOptions
                            .filter(
                              (node) =>
                                node.buildingId === editor.draft?.buildingId &&
                                node.status === "Active",
                            )
                            .map((node) => (
                              <MenuItem key={node.id} value={node.id}>
                                {node.name} · {node.code}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <FormControl fullWidth size="small">
                        <InputLabel id="region-parent-label">Visual parent</InputLabel>
                        <Select
                          labelId="region-parent-label"
                          label="Visual parent"
                          value={selectedRegion.parentRegionId ?? "none"}
                          onChange={(event) =>
                            dispatch({
                              type: "update",
                              region: {
                                ...selectedRegion,
                                parentRegionId:
                                  event.target.value === "none" ? null : event.target.value,
                              },
                            })
                          }
                        >
                          <MenuItem value="none">None</MenuItem>
                          {editor.draft?.regions
                            .filter(
                              (region) =>
                                region.id !== selectedRegion.id && region.status === "Active",
                            )
                            .map((region) => (
                              <MenuItem key={region.id} value={region.id}>
                                {region.displayName}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <TextField
                        fullWidth
                        label="Search aliases"
                        size="small"
                        value={selectedRegion.searchAliases.join(", ")}
                        helperText="Separate aliases with commas"
                        onChange={(event) =>
                          dispatch({
                            type: "update",
                            region: {
                              ...selectedRegion,
                              searchAliases: event.target.value
                                .split(",")
                                .map((alias) => alias.trim())
                                .filter((alias) => alias.length > 0),
                            },
                          })
                        }
                      />
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Button
                          size="small"
                          startIcon={<ArrowUpwardRounded />}
                          onClick={() =>
                            dispatch({
                              type: "update",
                              region: { ...selectedRegion, zOrder: selectedRegion.zOrder + 1 },
                            })
                          }
                          sx={{ minHeight: 36, px: 1.25 }}
                        >
                          Raise
                        </Button>
                        <Button
                          size="small"
                          startIcon={<ArrowDownwardRounded />}
                          onClick={() =>
                            dispatch({
                              type: "update",
                              region: { ...selectedRegion, zOrder: selectedRegion.zOrder - 1 },
                            })
                          }
                          sx={{ minHeight: 36, px: 1.25 }}
                        >
                          Lower
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          startIcon={<ArchiveRounded />}
                          onClick={() => {
                            if (window.confirm("Archive this map region?"))
                              dispatch({
                                type: "update",
                                region: {
                                  ...selectedRegion,
                                  status:
                                    selectedRegion.status === "Archived" ? "Active" : "Archived",
                                },
                              });
                          }}
                          sx={{ minHeight: 36, px: 1.25 }}
                        >
                          {selectedRegion.status === "Archived" ? "Restore" : "Archive"}
                        </Button>
                      </Stack>
                      <Button
                        fullWidth
                        variant="contained"
                        onClick={() => void save()}
                        disabled={!editor.dirty}
                        sx={{ mt: 0.5 }}
                      >
                        Save changes
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        Arrow keys move the selected region. Shift + Arrow moves farther.
                      </Typography>
                    </Stack>
                  )}
                </Stack>
              )}
            </Box>
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
              borderLeft: "1px solid #D9E0E9",
              bgcolor: "#FBFCFE",
            }}
          >
            <Tooltip title="Open region details" placement="left">
              <IconButton
                size="small"
                aria-label="Open region details"
                onClick={() => setInspectorOpen(true)}
              >
                <MapRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontWeight: 800 }}
            >
              Details
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

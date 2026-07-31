import { memo, useSyncExternalStore, type ReactElement } from "react";

import { MAP_UNITS, polylinePoints } from "./geometry";
import type { LiveGeometryStore } from "./live-geometry-store";

interface DrawPreviewLayerProps {
  readonly scale: number;
  readonly store: LiveGeometryStore;
}

const BRAND = "#00309D";

/**
 * The shape being drawn right now. The old editor showed nothing until the
 * pointer came up, so drawing felt like it had not registered.
 */
export const DrawPreviewLayer = memo(function DrawPreviewLayer({
  scale,
  store,
}: DrawPreviewLayerProps): ReactElement | null {
  const preview = useSyncExternalStore(store.subscribe, store.getPreview);
  if (preview === null) return null;

  if (preview.kind === "rectangle") {
    const { geometry } = preview;
    return (
      <rect
        aria-hidden="true"
        data-testid="draw-preview"
        x={geometry.x * MAP_UNITS}
        y={geometry.y * MAP_UNITS}
        width={geometry.width * MAP_UNITS}
        height={geometry.height * MAP_UNITS}
        fill={BRAND}
        fillOpacity={0.14}
        stroke={BRAND}
        strokeWidth={1.5}
        strokeDasharray="6 3"
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  const first = preview.points[0];
  const outline = preview.cursor === null ? preview.points : [...preview.points, preview.cursor];

  return (
    <g aria-hidden="true" data-testid="draw-preview">
      <polyline
        points={polylinePoints(outline)}
        fill="none"
        stroke={BRAND}
        strokeWidth={1.5}
        strokeDasharray="6 3"
        vectorEffect="non-scaling-stroke"
      />
      {preview.points.map((point, index) => (
        <circle
          key={`${String(point.x)}-${String(point.y)}-${String(index)}`}
          cx={point.x * MAP_UNITS}
          cy={point.y * MAP_UNITS}
          r={(index === 0 && preview.closeable ? 7 : 4) / scale}
          fill={index === 0 && preview.closeable ? BRAND : "#FFFFFF"}
          stroke={BRAND}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* Closing the ring by clicking the first point again, no keyboard needed. */}
      {preview.closeable && first !== undefined && preview.cursor !== null && (
        <line
          x1={preview.cursor.x * MAP_UNITS}
          y1={preview.cursor.y * MAP_UNITS}
          x2={first.x * MAP_UNITS}
          y2={first.y * MAP_UNITS}
          stroke={BRAND}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
});

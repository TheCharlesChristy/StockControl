import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keeps the newest value reachable from a callback that must not change
 * identity. Pointer handlers are registered once per gesture and read plenty of
 * state; rebuilding them on every render would defeat the memo boundaries that
 * keep dragging cheap.
 */
export function useLatestRef<Value>(value: Value): RefObject<Value> {
  const ref = useRef(value);

  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

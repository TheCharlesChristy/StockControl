import { useEffect, useState } from "react";

/**
 * Holds a value back until it stops changing.
 *
 * `useResource` refetches whenever its loader identity changes, so feeding it a
 * raw input value issues one request per keystroke. Location search is
 * particularly expensive on the server, which walks every map's regions.
 */
export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);

    return (): void => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}

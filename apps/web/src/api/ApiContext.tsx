import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { ApiClient, ApiError } from "./ApiClient";

const ApiContext = createContext<ApiClient | null>(null);

interface ApiProviderProps {
  readonly client?: ApiClient | undefined;
  readonly children: ReactNode;
}

export function ApiProvider({ client, children }: ApiProviderProps): ReactElement {
  const value = useMemo(() => client ?? new ApiClient(), [client]);

  return <ApiContext value={value}>{children}</ApiContext>;
}

export function useApi(): ApiClient {
  const client = use(ApiContext);

  if (client === null) {
    throw new Error("useApi must be used within an ApiProvider.");
  }

  return client;
}

export type ResourceStatus = "loading" | "ready" | "error";

export interface Resource<Value> {
  readonly status: ResourceStatus;
  readonly data: Value | undefined;
  readonly error: ApiError | undefined;
  /** Refetches while keeping the current data on screen, so nothing flashes. */
  readonly reload: () => void;
}

interface ResourceState<Value> {
  readonly status: ResourceStatus;
  readonly data: Value | undefined;
  readonly error: ApiError | undefined;
}

const initialState = { status: "loading", data: undefined, error: undefined } as const;

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError
    ? caught
    : new ApiError(0, "network.unreachable", "Could not reach StockControl.");
}

/**
 * The whole data-fetching layer: load on mount, cancel on unmount, reload on
 * demand. Deliberately not a cache — a demo of this size does not need one, and
 * a stale inventory number would undermine the thing being demonstrated.
 *
 * `load` must be stable (wrap it in useCallback); it is the effect's dependency.
 */
export function useResource<Value>(load: (signal: AbortSignal) => Promise<Value>): Resource<Value> {
  const [state, setState] = useState<ResourceState<Value>>(initialState);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    load(controller.signal)
      .then((value) => {
        if (active) {
          setState({ status: "ready", data: value, error: undefined });
        }
      })
      .catch((caught: unknown) => {
        if (active && !controller.signal.aborted) {
          setState((current) => ({
            status: "error",
            data: current.data,
            error: toApiError(caught),
          }));
        }
      });

    return (): void => {
      active = false;
      controller.abort();
    };
  }, [load, reloadCount]);

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  return { status: state.status, data: state.data, error: state.error, reload };
}

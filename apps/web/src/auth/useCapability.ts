import { roleHasCapability, type Capability } from "@stockcontrol/contracts";

import { useAuth } from "./AuthContext";

/**
 * Whether the signed-in role may do something.
 *
 * This decides which controls to render and nothing more — the server checks
 * the same rule on every request, so hiding a button is a courtesy, never the
 * protection.
 */
export function useCapability(capability: Capability): boolean {
  const { user } = useAuth();

  return user !== null && roleHasCapability(user.role, capability);
}

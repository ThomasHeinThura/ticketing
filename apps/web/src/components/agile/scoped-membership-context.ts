import { createContext } from "react";

/**
 * Set by the cycle and module detail screens around their work surface so the work item context
 * menu can offer "Remove from cycle / module". Outside those screens it is undefined and the menu
 * is unchanged.
 */
export type ScopedMembership = {
  kind: "cycle" | "module";
  id: string;
  canEdit: boolean;
};

export const ScopedMembershipContext = createContext<
  ScopedMembership | undefined
>(undefined);

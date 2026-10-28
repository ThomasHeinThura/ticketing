import { useMemo, useState } from "react";
import type { WorkspaceRoleDetail } from "@/fetchers/workspace-roles";
import { capabilityClosure, diffSelections } from "./capability-model";

/**
 * The editor's unsaved state, lifted so the capability matrix, the plain-language summary, the
 * preview and the comparison all describe the same DRAFT rather than the saved role (RL-11 to
 * RL-13 exist so a change can be checked before it is saved). Re-created per role version.
 */
export type RoleDraft = {
  name: string;
  description: string;
  rank: string;
  /** What the person ticked; the closure of it is what is stored (RL-5). */
  explicit: string[];
};

export function draftOf(role: WorkspaceRoleDetail): RoleDraft {
  return {
    name: role.name,
    description: role.description ?? "",
    rank: String(role.rank),
    explicit: [...role.capabilities],
  };
}

export function useRoleDraft(role: WorkspaceRoleDetail) {
  const [draft, setDraft] = useState<RoleDraft>(() => draftOf(role));
  const effective = useMemo(
    () => capabilityClosure(draft.explicit),
    [draft.explicit],
  );
  const savedClosure = useMemo(
    () => capabilityClosure(role.capabilities),
    [role.capabilities],
  );
  const changes = useMemo(
    () => diffSelections(savedClosure, effective),
    [savedClosure, effective],
  );
  const rankNumber = Number(draft.rank);
  const detailsChanged =
    draft.name.trim() !== role.name ||
    draft.description.trim() !== (role.description ?? "") ||
    (Number.isInteger(rankNumber) && rankNumber !== role.rank);
  const dirty =
    changes.added.length > 0 || changes.removed.length > 0 || detailsChanged;
  return {
    draft,
    setDraft,
    effective,
    changes,
    detailsChanged,
    dirty,
    reset: () => setDraft(draftOf(role)),
  };
}

export type RoleDraftState = ReturnType<typeof useRoleDraft>;

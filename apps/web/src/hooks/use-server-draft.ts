import { useState } from "react";

/**
 * A form draft based on one server snapshot. A pristine draft follows the server; a dirty draft
 * keeps its edits AND its original snapshot, so a later save is checked by the API against the
 * version the edits were made on (a stale base yields a conflict instead of a silent rebase).
 */
export function useServerDraft<S, D>(server: S, toDraft: (value: S) => D) {
  const [state, setState] = useState(() => ({
    base: server,
    draft: toDraft(server),
  }));
  const dirty =
    JSON.stringify(state.draft) !== JSON.stringify(toDraft(state.base));
  if (state.base !== server && !dirty) {
    setState({ base: server, draft: toDraft(server) });
  }
  return {
    base: state.base,
    draft: state.draft,
    dirty,
    setDraft: (patch: Partial<D>) =>
      setState((current) => ({
        ...current,
        draft: { ...current.draft, ...patch },
      })),
    /**
     * Discard edits. The draft becomes pristine, so it follows the next server snapshot (the
     * refetch after a reload, or this form's own write) instead of resurrecting stale input.
     */
    reset: () =>
      setState((current) => ({
        ...current,
        draft: toDraft(current.base),
      })),
  };
}

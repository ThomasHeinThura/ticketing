import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { replaceRequestTypeGroupOrder } from "@/fetchers/intake-group-order";

type GroupOrder = { groups: string[]; version: number };

/**
 * Local draft of the catalogue group order. The order is saved explicitly (with the server's
 * version) and can be cancelled back to the saved order; `changed` drives the Save/Cancel bar.
 */
export function useRequestTypeGroupOrder(
  workspaceId: string | undefined,
  saved: GroupOrder | undefined,
) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string[]>([]);
  useEffect(() => {
    if (saved) setDraft(saved.groups);
  }, [saved]);
  const save = useMutation({
    mutationFn: () =>
      replaceRequestTypeGroupOrder({
        workspaceId: workspaceId ?? "",
        groups: draft,
        version: saved?.version ?? 1,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["request-type-group-order", workspaceId], next);
      setDraft(next.groups);
    },
  });
  const changed =
    saved !== undefined &&
    (saved.groups.length !== draft.length ||
      saved.groups.some((group, index) => group !== draft[index]));
  const move = (index: number, delta: -1 | 1) => {
    setDraft((current) => {
      const target = index + delta;
      const source = current[index];
      const other = current[target];
      if (source === undefined || other === undefined) return current;
      const next = [...current];
      next[index] = other;
      next[target] = source;
      return next;
    });
    save.reset();
  };
  const cancel = () => {
    if (saved) setDraft(saved.groups);
    save.reset();
  };
  return { draft, changed, move, cancel, save };
}

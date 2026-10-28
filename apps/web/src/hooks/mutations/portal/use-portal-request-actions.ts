import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  escalatePortalSubmissionPriority,
  ratePortalSubmission,
  reopenPortalSubmission,
} from "@/fetchers/portal-request-actions";

/**
 * The customer's request actions (CP-7, CP-8, CP-9). Each answers with the updated submission
 * projection, which replaces the cached detail at once and is then re-read; the list and home rows are refetched
 * because their status and due time change with it.
 */
export function usePortalRequestActions(portalUserId: string, ref: string) {
  const queryClient = useQueryClient();
  const detailKey = ["portal", portalUserId, "submission", ref] as const;
  const onSuccess = (updated: unknown) => {
    if (updated && typeof updated === "object")
      queryClient.setQueryData(detailKey, updated);
    void queryClient.invalidateQueries({ queryKey: detailKey });
    void queryClient.invalidateQueries({
      queryKey: ["portal", portalUserId, "submissions"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["portal", portalUserId, "recent-submissions"],
    });
  };
  const escalate = useMutation({
    mutationFn: (priority: string) =>
      escalatePortalSubmissionPriority({ ref, priority }),
    onSuccess,
  });
  const reopen = useMutation({
    mutationFn: () => reopenPortalSubmission(ref),
    onSuccess,
  });
  const rate = useMutation({
    mutationFn: (input: { rating: number; comment?: string }) =>
      ratePortalSubmission({ ref, ...input }),
    onSuccess,
  });
  return { escalate, reopen, rate };
}

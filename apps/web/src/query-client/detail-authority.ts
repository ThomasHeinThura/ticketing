import type { QueryClient } from "@tanstack/react-query";

/**
 * Work item detail reads (the list's hover and focus reads included) belong to the authority they
 * were started under: the caller's role and the active workspace. When either changes, every
 * detail read is reset: one in flight is cancelled and its late answer discarded, a kept answer is
 * dropped, and an open screen reads again under the new authority (a refusal clears it). Without
 * this, a read started before the change satisfied the five-second reuse rule after it.
 */
export function purgeWorkItemDetailReads(queryClient: QueryClient) {
  void queryClient.resetQueries({ queryKey: ["work-items", "detail"] });
}

/**
 * Role and membership changes already invalidate the caller's membership
 * (`["workspace-user", "active"]`) and capability (`["workspace-capabilities", ...]`) queries;
 * follow those invalidations. A workspace switch is followed by `followAgentSession`.
 */
export function followWorkItemDetailAuthority(queryClient: QueryClient) {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "invalidate") return;
    const [root, scope] = event.query.queryKey;
    if (
      root === "workspace-capabilities" ||
      (root === "workspace-user" && scope === "active")
    )
      purgeWorkItemDetailReads(queryClient);
  });
}

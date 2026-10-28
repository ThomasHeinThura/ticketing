import queryClient from "@/query-client";

/**
 * The portal host marks its app shell when `feature.customer_portal` is not on for this
 * visitor (P3-R2-03): `disabled` when the flag is off (404), `unavailable` when it could not be
 * read (503, P4R2-L1). The portal app then shows its feature-off state instead of signing in.
 */
export type PortalStateMarker = "disabled" | "unavailable";

export const PORTAL_STATE_META_NAME = "taskdesk-portal-state";

export function readPortalStateMarker(
  doc: Pick<Document, "querySelector"> | undefined = typeof document ===
  "undefined"
    ? undefined
    : document,
): PortalStateMarker | null {
  const content = doc
    ?.querySelector(`meta[name="${PORTAL_STATE_META_NAME}"]`)
    ?.getAttribute("content");
  return content === "disabled" || content === "unavailable" ? content : null;
}

/**
 * P4R2-M2: after an in-app sign-in no new document is loaded, so the host's marker cannot say
 * that the portal is off for this customer's organisation; the root asks the API instead
 * (cached briefly, and cleared with the rest of the cache on sign-in and sign-out). A failed read
 * leaves the pages to their own error states.
 */
export async function organisationPortalState(
  userId: string,
): Promise<PortalStateMarker | null> {
  try {
    const state = await queryClient.fetchQuery({
      queryKey: ["portal", "feature-state", userId],
      queryFn: async () =>
        (await import("@/fetchers/feature-flags")).getPortalFeatureState(),
      staleTime: 30_000,
      retry: false,
    });
    return state === "off"
      ? "disabled"
      : state === "unavailable"
        ? "unavailable"
        : null;
  } catch {
    return null;
  }
}

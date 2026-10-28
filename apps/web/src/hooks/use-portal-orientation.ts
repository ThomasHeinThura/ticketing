import { useCallback, useState } from "react";

// CP-14: the first-time orientation is dismissed once per customer. The portal host cannot reach
// the profile-settings API (`/api/me/settings` is an agent route), so the dismissal is kept in this
// browser, keyed by the signed-in customer. It never blocks anything: if storage is unavailable the
// notice is simply shown again on the next visit.
const keyFor = (portalUserId: string) =>
  `taskdesk.portal.orientation.dismissed.${portalUserId}`;

function readDismissed(portalUserId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(keyFor(portalUserId)) === "1";
  } catch {
    return false;
  }
}

export function usePortalOrientation(portalUserId: string) {
  const [dismissedFor, setDismissedFor] = useState<string | null>(() =>
    readDismissed(portalUserId) ? portalUserId : null,
  );
  const dismiss = useCallback(() => {
    setDismissedFor(portalUserId);
    try {
      globalThis.localStorage?.setItem(keyFor(portalUserId), "1");
    } catch {
      // Best effort only.
    }
  }, [portalUserId]);
  return { visible: dismissedFor !== portalUserId, dismiss };
}

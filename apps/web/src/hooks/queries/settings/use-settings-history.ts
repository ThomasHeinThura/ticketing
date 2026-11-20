import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useSyncExternalStore } from "react";
import getProject from "@/fetchers/project/get-project";
import {
  getSelfHistory,
  type SelfHistory,
} from "@/fetchers/settings/personal-history";
import {
  getSettingsHistory,
  type SettingsHistory,
} from "@/fetchers/settings/settings-history";
import { getTimeSettings } from "@/fetchers/time-tracking";
import { authClient } from "@/lib/auth-client";
import { HttpError } from "@/lib/http-error";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { profileSessionGuard } from "@/lib/profile-session-guard";
import { portalSessionQueryKey } from "@/query-client";
import {
  type HistoryTarget,
  historyStamp,
  historyTargetHash,
  SETTINGS_HISTORY_KEY,
  subscribeHistory,
} from "@/query-client/settings-history-key";

export type {
  HistoryScope,
  HistoryTarget,
} from "@/query-client/settings-history-key";

export type HistoryView = SettingsHistory | SelfHistory;
export type HistoryState =
  | { status: "hidden" | "checking" | "error" }
  | { status: "ready"; data: HistoryView };

type Identity = {
  audience: "staff" | "portal";
  userId: string;
  sessionId: string;
  host: string;
};

/** Refusals that mean "not yours to see": hide, never offer Retry. */
const isDenied = (error: unknown) =>
  error instanceof HttpError && [401, 403, 404].includes(error.status);

function useStaffIdentity(): Identity | null {
  const { data } = authClient.useSession();
  const userId = data?.user?.id;
  const sessionId = data?.session?.id;
  return userId && sessionId
    ? { audience: "staff", userId, sessionId, host: window.location.host }
    : null;
}

function usePortalIdentity(): Identity | null {
  const { data } = useQuery({
    queryKey: portalSessionQueryKey,
    queryFn: async () => {
      const result = await portalAuthClient.getSession();
      if (result.error) throw new Error("Session unavailable");
      return result.data;
    },
    staleTime: 30_000,
  });
  const userId = data?.user?.id;
  const sessionId = data?.session?.id;
  return userId && sessionId
    ? { audience: "portal", userId, sessionId, host: window.location.host }
    : null;
}

/** Fresh session read: a refused or failed check throws its own status, a different person is a 403. */
async function checkSession({ audience, userId, sessionId, host }: Identity) {
  if (window.location.host !== host) throw new HttpError(403, "Host changed");
  if (audience === "staff") return profileSessionGuard(userId, sessionId)();
  const { data, error } = await portalAuthClient.getSession();
  if (error) throw new HttpError(error.status, "Session unavailable");
  if (data?.user?.id !== userId || data.session?.id !== sessionId)
    throw new HttpError(403, "Session changed");
}

async function readTarget(
  target: HistoryTarget,
  signal: AbortSignal,
): Promise<HistoryView> {
  if (target.kind === "self") return getSelfHistory(target, signal);
  if (target.kind === "entity") {
    // Only terminology cells are addressed by a scope selector; the API rejects it elsewhere.
    const { scope } = target;
    if (scope.kind === "project") {
      const project = await getProject({
        id: scope.projectId,
        workspaceId: scope.workspaceId,
      });
      if (
        project.id !== scope.projectId ||
        project.workspaceId !== scope.workspaceId
      )
        throw new HttpError(404, "Project unavailable");
    }
    if (
      scope.kind === "workspace" &&
      target.type === "workspace" &&
      target.id !== scope.workspaceId
    )
      throw new HttpError(404, "Workspace unavailable");
    const selector =
      target.type !== "terminology_override"
        ? undefined
        : scope.kind === "workspace"
          ? ({ scope: "workspace", workspaceId: scope.workspaceId } as const)
          : ({ scope: "instance" } as const);
    return selector
      ? getSettingsHistory(target.type, target.id, signal, selector)
      : getSettingsHistory(target.type, target.id, signal);
  }
  const { workspaceId } = target.scope;
  const projectId =
    target.scope.kind === "project" ? target.scope.projectId : undefined;
  const [settings, history] = await Promise.all([
    getTimeSettings(workspaceId, projectId),
    getSettingsHistory(
      projectId ? "project" : "workspace",
      projectId ?? workspaceId,
      signal,
    ),
  ]);
  if (projectId && settings.project?.id !== projectId)
    throw new HttpError(404, "Project unavailable");
  return history;
}

// One counter orders every read and every mount/revalidation: rows show only for a read that
// started after the latest mount or revalidation of this panel.
let counter = 0;
const activeReads = new WeakMap<object, number>();

/**
 * The only way to read History. The reader checks the session before and after the API read;
 * cached data, cancellation rollbacks and resolved refetch promises never admit rows.
 */
export function useSettingsHistory(target: HistoryTarget): {
  state: HistoryState;
  revalidate(): void;
} {
  const identity = (
    target.kind === "self" && target.audience === "portal"
      ? usePortalIdentity
      : useStaffIdentity
  )();
  const client = useQueryClient();
  const hash = historyTargetHash(target);
  const stamp = useSyncExternalStore(subscribeHistory, () =>
    historyStamp(hash),
  );
  const queryKey = [
    SETTINGS_HISTORY_KEY,
    identity?.host,
    identity?.audience,
    identity?.userId,
    identity?.sessionId,
    stamp,
    hash,
  ];
  const [mounted] = useState(() => {
    const query = client.getQueryCache().find({ queryKey, exact: true });
    const active =
      query?.state.fetchStatus === "fetching"
        ? activeReads.get(query)
        : undefined;
    return active === undefined ? ++counter : active - 1;
  });
  const floor = useRef(mounted);
  const history = useQuery({
    queryKey,
    enabled: Boolean(identity),
    staleTime: 0,
    networkMode: "always",
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) => {
      const read = ++counter;
      const query = client.getQueryCache().find({ queryKey, exact: true });
      if (query) activeReads.set(query, read);
      try {
        if (!identity) throw new HttpError(401, "Session unavailable");
        await checkSession(identity);
        const view = await readTarget(target, signal);
        await checkSession(identity);
        return { read, view };
      } catch (error) {
        // Remove the rows now; a refusal also hides the panel.
        if (!signal.aborted && isDenied(error))
          client.setQueryData(queryKey, null);
        throw error;
      }
    },
  });
  const revalidate = () => {
    if (!identity) return;
    // Advance before cancelling: a cancelled read resolves with its older data, which must not show.
    floor.current = ++counter;
    void client
      .cancelQueries({ queryKey, exact: true })
      .then(() => history.refetch());
  };
  let state: HistoryState;
  if (!identity || (history.isError && isDenied(history.error)))
    state = { status: "hidden" };
  else if (history.fetchStatus === "fetching" || history.isPending)
    state = { status: "checking" };
  else if (
    history.isSuccess &&
    history.data &&
    history.data.read > floor.current
  )
    state = { status: "ready", data: history.data.view };
  // A failed read, or one cancelled so that only older data is left: Retry, no metadata.
  else state = { status: "error" };
  return { state, revalidate };
}

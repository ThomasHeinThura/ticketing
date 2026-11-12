import {
  type Query,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";

/**
 * `error`: the capability read itself failed (network, 5xx, unknown project), so the caller's
 * access is unknown. It fails closed like `denied` (the screen's queries never run) but offers
 * Retry instead of a permanent "Checking your access" skeleton (UAT re-audit).
 */
export type SettingsAccess = "checking" | "allowed" | "denied" | "error";

type Permission = ReturnType<typeof useWorkspacePermission>;

/**
 * Whether the caller holds the capability a screen's own read route requires, resolved BEFORE the
 * screen's queries run: a role without it sees one denial notice and the browser never sends the
 * request the server would refuse with 403 (UAT re-audit). The server stays the authority; a 403
 * that still arrives is mapped with {@link isForbiddenError}.
 *
 * Reads the capabilities for the active workspace (and, with `projectId`, that project), the same
 * cached `/api/capabilities` read the navigation uses, so this adds no request of its own.
 */
export function useSettingsAccess(
  allows: (permission: Permission) => boolean,
  projectId?: string,
  options?: { refreshOnMount?: boolean },
): SettingsAccess {
  const { data: workspace } = useActiveWorkspace();
  const permission = useWorkspacePermission(
    workspace?.id,
    projectId,
    ...(options ? ([options] as const) : ([] as const)),
  );
  const checkFailed = useCapabilityCheckFailed(
    permission.isCheckingPermissions ? workspace?.id : undefined,
    projectId,
  );
  if (!workspace?.id) return "checking";
  // Sensitive settings need a fresh check even when the shared cache has data, but only until
  // the first fresh read after mount has settled: a later background refetch must not send an
  // open editor back to "checking" and drop its unsaved draft.
  if (permission.isPermissionRefreshPending) {
    if (
      permission.isPermissionError &&
      !permission.isRefetchingPermissions &&
      !permission.isPermissionCheckPaused
    )
      return "error";
    return "checking";
  }
  if (permission.isCheckingPermissions)
    return checkFailed ? "error" : "checking";
  return allows(permission) ? "allowed" : "denied";
}

const CAPABILITIES_KEY = "workspace-capabilities";

/**
 * The `/api/capabilities` cache entries `useWorkspacePermission(workspaceId, projectId)` reads:
 * `[CAPABILITIES_KEY, workspaceId, role | "work-item-target"]` for the workspace, and
 * `[CAPABILITIES_KEY, workspaceId, "work-item-target", projectId]` for one project.
 */
function isCapabilityScope(
  query: Query,
  workspaceId: string,
  projectId: string | undefined,
) {
  const [root, workspace, scope, project] = query.queryKey;
  if (root !== CAPABILITIES_KEY || workspace !== workspaceId) return false;
  return projectId
    ? scope === "work-item-target" && project === projectId
    : project === undefined;
}

/** Settled in error with nothing to show: retries are spent and no fetch is in flight. */
function hasFailed(query: Query) {
  return (
    query.state.status === "error" &&
    query.state.fetchStatus === "idle" &&
    query.state.data === undefined
  );
}

/**
 * Whether the capability read for this scope has failed. `useWorkspacePermission` keeps reporting
 * "checking" after its query errors (it has no capabilities yet), so the failure is read from the
 * shared query cache: no request of its own. Pass no `workspaceId` to skip the check.
 */
export function useCapabilityCheckFailed(
  workspaceId: string | undefined,
  projectId?: string,
) {
  const queryCache = useQueryClient().getQueryCache();
  const subscribe = useCallback(
    (onChange: () => void) => queryCache.subscribe(onChange),
    [queryCache],
  );
  const getSnapshot = useCallback(
    () =>
      workspaceId !== undefined &&
      queryCache
        .findAll({ queryKey: [CAPABILITIES_KEY, workspaceId] })
        .some(
          (query) =>
            isCapabilityScope(query, workspaceId, projectId) &&
            hasFailed(query),
        ),
    [queryCache, workspaceId, projectId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Retries every capability read that failed; the screens waiting on them re-resolve. */
export function retryFailedCapabilityChecks(queryClient: QueryClient) {
  return queryClient.refetchQueries({
    queryKey: [CAPABILITIES_KEY],
    predicate: (query) => query.state.status === "error",
  });
}

/** A 403 from any settings fetcher (they all carry the HTTP status). */
export function isForbiddenError(error: unknown) {
  if (error instanceof HttpError) return error.status === 403;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 403
  );
}

/** The one notice a settings screen shows to a role that cannot read it: no error, no Retry. */
export function SettingsAccessDenied({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  const { t } = useTranslation();
  return (
    <Empty data-testid="settings-access-denied">
      <EmptyHeader>
        <EmptyTitle>{title ?? t("settings:accessDenied.title")}</EmptyTitle>
        <EmptyDescription>
          {description ?? t("settings:accessDenied.description")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Placeholder while the capability check resolves, so neither the denial nor the queries flash. */
export function SettingsAccessChecking({
  className,
  visible = true,
}: {
  className?: string;
  visible?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("settings:accessDenied.checking")}
      style={{ visibility: visible ? "visible" : "hidden" }}
    >
      <Skeleton className={className ?? "h-32 w-full"} />
    </div>
  );
}

/** The capability check failed: access is unknown, so only the error and Retry are shown. */
export function SettingsAccessError() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (
    <Alert variant="error" data-testid="settings-access-error">
      <AlertTitle>{t("settings:accessDenied.loadErrorTitle")}</AlertTitle>
      <AlertDescription>
        {t("settings:accessDenied.loadErrorDescription")}
        <Button
          className="w-fit"
          onClick={() => void retryFailedCapabilityChecks(queryClient)}
        >
          {t("common:actions.retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Renders `children` only once the caller is known to hold the capability. */
export function SettingsAccessGate({
  access,
  children,
  deniedTitle,
  deniedDescription,
}: {
  access: SettingsAccess;
  children: React.ReactNode;
  deniedTitle?: string;
  deniedDescription?: string;
}) {
  const placeholderVisible = useDelayedPending(access === "checking");
  if (access === "checking" || (access === "allowed" && placeholderVisible))
    return <SettingsAccessChecking visible={placeholderVisible} />;
  if (access === "error") return <SettingsAccessError />;
  if (access === "denied")
    return (
      <SettingsAccessDenied
        title={deniedTitle}
        description={deniedDescription}
      />
    );
  return <>{children}</>;
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertAction,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Frame,
  FramePanel,
  LoadingStatus,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useDelayedPending,
} from "@taskdesk/ui";
import { Ban, History, ServerCog, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import { ApiKeyCreatedModal } from "@/components/settings/api-key-created-modal";
import {
  CreateServiceKeyDialog,
  serviceKeysKey,
} from "@/components/settings/create-service-key-dialog";
import { refreshSettingsHistory } from "@/components/settings/refresh-settings-history";
import { SettingsHistory } from "@/components/settings/settings-history";
import {
  listServiceKeys,
  reattestServiceKey,
  requestServiceKeyDeletion,
  revokeServiceKey,
} from "@/fetchers/service-keys";
import { assertNotificationHistorySession } from "@/fetchers/settings/personal-history";
import {
  getSettingsHistory,
  settingsHistoryQueryKey,
} from "@/fetchers/settings/settings-history";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { HttpError, localizedAdminErrorMessage } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import type { ApiKey } from "@/types/api-key";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

type HistoryIdentity = { host: string; userId: string; sessionId: string };
type HistoryTarget = {
  id: string;
  name: string;
  workspaceId: string;
  identity: HistoryIdentity;
};

function ServiceKeyHistoryDialog({
  target,
  onClose,
  listReady,
}: {
  target: HistoryTarget;
  onClose: () => void;
  listReady: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { host, userId, sessionId } = target.identity;
  const historyKey = settingsHistoryQueryKey(
    "service_api_key",
    target.id,
    userId,
    sessionId,
  );
  const admission = useQuery({
    queryKey: [
      "service-key-history-admission",
      host,
      userId,
      sessionId,
      target.workspaceId,
      target.id,
    ],
    queryFn: async ({ signal }) => {
      try {
        await assertNotificationHistorySession(
          "staff",
          userId,
          sessionId,
          host,
        );
        const history = await getSettingsHistory(
          "service_api_key",
          target.id,
          signal,
        );
        await assertNotificationHistorySession(
          "staff",
          userId,
          sessionId,
          host,
        );
        if (!signal.aborted) queryClient.setQueryData(historyKey, history);
        return history;
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof HttpError &&
          [401, 403, 404].includes(error.status)
        )
          queryClient.setQueryData(historyKey, null);
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const awaitingAdmission =
    !listReady ||
    admission.isFetching ||
    admission.isPending ||
    admission.isPaused ||
    !admission.isFetchedAfterMount;
  const denied =
    !awaitingAdmission &&
    admission.isError &&
    admission.error instanceof HttpError &&
    [401, 403, 404].includes(admission.error.status);
  useEffect(() => {
    if (denied) onClose();
  }, [denied, onClose]);
  if (denied) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{target.name}</DialogTitle>
          <DialogDescription>
            {t("settings:serviceKeys.description")}
          </DialogDescription>
        </DialogHeader>
        {awaitingAdmission ? (
          <LoadingStatus visible label={t("common:empty.loading")}>
            <span>{t("common:empty.loading")}</span>
          </LoadingStatus>
        ) : admission.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("settings:history.error")}</AlertTitle>
            <Button variant="outline" onClick={() => void admission.refetch()}>
              {t("settings:history.retry")}
            </Button>
          </Alert>
        ) : (
          <SettingsHistory
            type="service_api_key"
            id={target.id}
            userId={userId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReattestServiceKeyDialog({
  workspaceId,
  apiKey,
  onClose,
  historyIdentity,
  captureIntent,
  isCurrent,
}: {
  workspaceId: string;
  apiKey: ApiKey;
  onClose: () => void;
  historyIdentity: HistoryIdentity | null;
  captureIntent: () => number;
  isCurrent: (intent: number) => boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const stepUp = useStepUpAction();
  const reattest = useMutation({
    mutationFn: async ({
      keyId,
      savedWorkspaceId,
      version,
    }: {
      keyId: string;
      savedWorkspaceId: string;
      version: number;
      identity: HistoryIdentity | null;
      intent: number;
    }) => {
      const outcome = await stepUp.run(
        {
          operation: "service_key_reattest",
          workspaceId: savedWorkspaceId,
          keyId,
          expectedVersion: version,
        },
        (token) => reattestServiceKey(savedWorkspaceId, keyId, version, token),
      );
      if (!outcome.ok) return undefined;
      return outcome.value;
    },
    onSuccess: async (
      updated,
      { keyId, savedWorkspaceId, identity: captured, intent },
    ) => {
      if (!updated) return;
      if (captured && updated.id === keyId) {
        const { host, userId, sessionId } = captured;
        refreshSettingsHistory(
          queryClient,
          settingsHistoryQueryKey("service_api_key", keyId, userId, sessionId),
          () =>
            assertNotificationHistorySession("staff", userId, sessionId, host),
        );
      }
      if (!isCurrent(intent)) return;
      toast.success(t("settings:serviceKeys.reattest.success"));
      onClose();
      void queryClient.invalidateQueries({
        queryKey: ["service-key-history-list", savedWorkspaceId],
      });
      await queryClient.invalidateQueries({
        queryKey: serviceKeysKey(savedWorkspaceId),
      });
    },
    onError: (_error, { intent }) => {
      if (isCurrent(intent))
        toast.error(t("settings:serviceKeys.reattest.failure"));
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !stepUp.busy) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("settings:serviceKeys.reattest.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:serviceKeys.reattest.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <StepUpFields action={stepUp} idPrefix="service-key-reattest" />
          <FailureAlert
            failure={stepUp.failure}
            title={t("settings:serviceKeys.reattest.failure")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={stepUp.busy} onClick={onClose}>
            {t("settings:serviceKeys.reattest.cancel")}
          </Button>
          <Button
            disabled={stepUp.busy || !stepUp.canRun || reattest.isPending}
            onClick={() =>
              reattest.mutate({
                keyId: apiKey.id,
                savedWorkspaceId: workspaceId,
                version: apiKey.accountabilityVersion,
                identity: historyIdentity,
                intent: captureIntent(),
              })
            }
          >
            {t("settings:serviceKeys.reattest.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * AK-1 / AK-7 / AK-11: the active workspace's service keys. Gated upfront on `api_key:manage`
 * (`canManageApiKeys`) so viewers/members never issue `GET /service-keys` (or log 403s); the
 * 403 error path below remains defense-in-depth alongside server enforcement. Revocation is
 * immediate; deletion is a typed-name + step-up pending action on the pending actions screen.
 */
export function ServiceKeysCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: session } = authClient.useSession();
  const host = window.location.host;
  const userId = session?.user?.id;
  const sessionId = session?.session?.id;
  const sessionScope = session?.session as
    | { portal?: string | null; impersonatedBy?: string | null }
    | undefined;
  const identity =
    userId &&
    sessionId &&
    !sessionScope?.impersonatedBy &&
    (!sessionScope?.portal || sessionScope.portal === "agent")
      ? { host, userId, sessionId }
      : null;
  const { canManageApiKeys, isCheckingPermissions } = useWorkspacePermission();
  const canManage = canManageApiKeys();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(
    null,
  );
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [reattesting, setReattesting] = useState<ApiKey | null>(null);
  const [historyTarget, setHistoryTarget] = useState<HistoryTarget | null>(
    null,
  );
  const lifecycle = useIntentLifecycle(
    JSON.stringify([
      host,
      userId,
      sessionId,
      sessionScope?.portal,
      sessionScope?.impersonatedBy,
      workspaceId,
    ]),
    () => {
      setHistoryTarget(null);
      setRevoking(null);
      setReattesting(null);
      setCreating(false);
      setCreated(null);
    },
  );

  const query = useQuery({
    queryKey: serviceKeysKey(workspaceId),
    enabled: Boolean(workspaceId && !isCheckingPermissions && canManage),
    queryFn: async () => {
      try {
        return await listServiceKeys(workspaceId);
      } catch (error) {
        // Expected when a caller lacks `api_key:manage`: treat 403 as absent instead of logging a QueryCache error.
        if (error instanceof HttpError && error.status === 403) return null;
        throw error;
      }
    },
  });

  const historyList = useQuery({
    queryKey: [
      "service-key-history-list",
      workspaceId,
      host,
      userId,
      sessionId,
    ],
    enabled: Boolean(
      identity &&
        workspaceId &&
        canManage &&
        !isCheckingPermissions &&
        query.isSuccess &&
        query.data,
    ),
    queryFn: async () => {
      if (!identity) throw new Error("Session unavailable");
      await assertNotificationHistorySession(
        "staff",
        identity.userId,
        identity.sessionId,
        identity.host,
      );
      const result = await listServiceKeys(workspaceId);
      await assertNotificationHistorySession(
        "staff",
        identity.userId,
        identity.sessionId,
        identity.host,
      );
      return result;
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const historyReady = Boolean(
    identity &&
      canManage &&
      !isCheckingPermissions &&
      query.isSuccess &&
      !query.isFetching &&
      !query.isPaused &&
      !query.isError &&
      historyList.isSuccess &&
      historyList.isFetchedAfterMount &&
      !historyList.isFetching &&
      !historyList.isPaused &&
      !historyList.isError,
  );
  const currentTarget = Boolean(
    historyTarget &&
      identity &&
      canManage &&
      !isCheckingPermissions &&
      historyTarget.workspaceId === workspaceId &&
      historyTarget.identity.host === host &&
      historyTarget.identity.userId === userId &&
      historyTarget.identity.sessionId === sessionId,
  );
  const selectedLive = Boolean(
    currentTarget &&
      historyTarget &&
      historyReady &&
      query.data?.some((row) => row.id === historyTarget.id) &&
      historyList.data?.some(
        (row) =>
          row.id === historyTarget.id &&
          row.workspaceId === workspaceId &&
          row.kind === "service" &&
          !row.isMcp,
      ),
  );
  const keepDialog =
    selectedLive ||
    (currentTarget &&
      (query.isFetching ||
        query.isPaused ||
        historyList.isFetching ||
        historyList.isPaused));
  useEffect(() => {
    if (historyTarget && !keepDialog) {
      queryClient.setQueryData(
        settingsHistoryQueryKey(
          "service_api_key",
          historyTarget.id,
          historyTarget.identity.userId,
          historyTarget.identity.sessionId,
        ),
        null,
      );
      setHistoryTarget(null);
    }
  }, [historyTarget, keepDialog, queryClient]);

  const placeholderVisible = useDelayedPending(query.isLoading, {
    releaseNow:
      query.isSuccess && (query.data === null || query.data.length === 0),
  });

  const revoke = useMutation({
    mutationFn: ({
      key,
      savedWorkspaceId,
    }: {
      key: ApiKey;
      savedWorkspaceId: string;
      identity: HistoryIdentity | null;
      intent: number;
    }) => revokeServiceKey(savedWorkspaceId, key.id),
    onSuccess: async (
      updated,
      { key, savedWorkspaceId, identity: captured, intent },
    ) => {
      if (captured && updated.id === key.id) {
        const { host, userId, sessionId } = captured;
        refreshSettingsHistory(
          queryClient,
          settingsHistoryQueryKey("service_api_key", key.id, userId, sessionId),
          () =>
            assertNotificationHistorySession("staff", userId, sessionId, host),
        );
      }
      if (!lifecycle.isCurrent(intent)) return;
      toast.success(t("settings:serviceKeys.toastRevoked"));
      setRevoking(null);
      void queryClient.invalidateQueries({
        queryKey: ["service-key-history-list", savedWorkspaceId],
      });
      await queryClient.invalidateQueries({
        queryKey: serviceKeysKey(savedWorkspaceId),
      });
    },
    onError: (error, { intent }) => {
      if (lifecycle.isCurrent(intent))
        toast.error(
          localizedAdminErrorMessage(
            error,
            t,
            t("settings:serviceKeys.toastRevokeError"),
          ),
          { error },
        );
    },
  });

  const requestDeletion = useMutation({
    mutationFn: ({
      key,
      savedWorkspaceId,
    }: {
      key: ApiKey;
      savedWorkspaceId: string;
      intent: number;
    }) => requestServiceKeyDeletion(savedWorkspaceId, key.id),
    onSuccess: (_result, { intent }) => {
      if (!lifecycle.isCurrent(intent)) return;
      toast.success(t("settings:serviceKeys.deleteRequested"));
      void navigate({ to: routes.pendingActions.path as never });
    },
    onError: (error, { intent }) => {
      if (lifecycle.isCurrent(intent))
        toast.error(
          localizedAdminErrorMessage(
            error,
            t,
            t("settings:serviceKeys.deleteFailed"),
          ),
          { error },
        );
    },
  });

  if (!workspaceId || isCheckingPermissions || !canManage) return null;
  if (
    query.data === null ||
    (query.error instanceof HttpError && query.error.status === 403)
  )
    return null;

  const keys = query.data ?? [];

  return (
    <>
      <CardFrame>
        <Card className="!rounded-none !border-t-0">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2 text-base">
              <ServerCog className="size-4" />
              {t("settings:serviceKeys.title")}
            </CardTitle>
            <CardDescription>
              {t("settings:serviceKeys.description")}
            </CardDescription>
            <CardAction>
              <Button
                disabled={query.isLoading || query.isError}
                onClick={() => setCreating(true)}
              >
                {t("settings:serviceKeys.create.open")}
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
        <Card className="!rounded-none">
          <CardPanel>
            {!query.isError && (query.isLoading || placeholderVisible) ? (
              <LoadingStatus
                visible={placeholderVisible}
                label={t("common:empty.loading")}
              >
                <Frame
                  style={{
                    visibility: placeholderVisible ? "visible" : "hidden",
                  }}
                >
                  <FramePanel className="p-8">
                    <p className="text-center text-sm text-muted-foreground">
                      {t("settings:serviceKeys.loading")}
                    </p>
                  </FramePanel>
                </Frame>
              </LoadingStatus>
            ) : query.isError ? (
              <Alert variant="error" role="alert">
                <AlertTitle>
                  {t("settings:instanceApiKeys.loadError")}
                </AlertTitle>
                <AlertAction>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void query.refetch()}
                  >
                    {t("common:actions.retry")}
                  </Button>
                </AlertAction>
              </Alert>
            ) : keys.length === 0 ? (
              <Frame>
                <FramePanel className="p-8">
                  <p className="text-center text-sm text-muted-foreground">
                    {t("settings:serviceKeys.empty")}
                  </p>
                </FramePanel>
              </Frame>
            ) : (
              <Frame>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("settings:apiKey.table.columnName")}
                      </TableHead>
                      <TableHead>
                        {t("settings:apiKey.table.columnKey")}
                      </TableHead>
                      <TableHead>
                        {t("settings:apiKey.table.columnAccess")}
                      </TableHead>
                      <TableHead>
                        {t("settings:apiKey.table.columnLastUsed")}
                      </TableHead>
                      <TableHead>
                        {t("settings:apiKey.table.columnExpires")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("settings:apiKey.table.columnActions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key, index) => (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">
                          <div className="flex max-w-[18rem] flex-wrap items-center gap-1">
                            <span className="break-words">
                              {key.name ||
                                t("settings:apiKey.table.unnamedKey")}
                            </span>
                            {!key.enabled && (
                              <Badge variant="error">
                                {t("settings:apiKey.table.revokedBadge")}
                              </Badge>
                            )}
                            {key.createdByFormerMember && (
                              <Badge variant="warning">
                                {t("settings:serviceKeys.formerMember")}
                              </Badge>
                            )}
                            {key.ownedByWorkspaceAdmins && (
                              <Badge variant="outline">
                                {t("settings:serviceKeys.ownershipTransferred")}
                              </Badge>
                            )}
                            {key.requiresReattestation && (
                              <Badge variant="warning">
                                {t(
                                  "settings:serviceKeys.reattestationRequired",
                                )}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="rounded border border-border bg-background px-2 py-1 text-xs">
                            {key.start}...
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={key.writesEnabled ? "warning" : "outline"}
                          >
                            {key.writesEnabled
                              ? t("settings:apiKey.table.accessReadWrite")
                              : t("settings:apiKey.table.accessReadOnly")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {key.lastUsedAt
                            ? key.lastUsedIp
                              ? t("settings:apiKey.table.lastUsedFrom", {
                                  date: formatDate(key.lastUsedAt),
                                  ip: key.lastUsedIp,
                                })
                              : formatDate(key.lastUsedAt)
                            : t("settings:apiKey.table.neverUsed")}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {key.expiresAt
                            ? formatDate(key.expiresAt)
                            : t("common:formats.never")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {historyReady &&
                            identity &&
                            historyList.data?.some(
                              (row) =>
                                row.id === key.id &&
                                row.workspaceId === workspaceId &&
                                row.kind === "service" &&
                                !row.isMcp,
                            ) ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={t(
                                  "settings:history.memberHistory",
                                  {
                                    name:
                                      key.name ||
                                      t("settings:apiKey.table.unnamedKey"),
                                    number: index + 1,
                                  },
                                )}
                                onClick={() =>
                                  setHistoryTarget({
                                    id: key.id,
                                    workspaceId,
                                    identity,
                                    name: t("settings:history.memberHistory", {
                                      name:
                                        key.name ||
                                        t("settings:apiKey.table.unnamedKey"),
                                      number: index + 1,
                                    }),
                                  })
                                }
                              >
                                <History
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </Button>
                            ) : null}
                            {key.requiresReattestation && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setReattesting(key);
                                }}
                              >
                                {t("settings:serviceKeys.reattest.submit")}
                              </Button>
                            )}
                            {key.enabled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                aria-label={t(
                                  "settings:apiKey.table.revokeAria",
                                  { name: key.name ?? key.id },
                                )}
                                onClick={() => setRevoking(key)}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              disabled={requestDeletion.isPending}
                              aria-label={t("settings:serviceKeys.deleteAria", {
                                name: key.name ?? key.id,
                              })}
                              onClick={() =>
                                requestDeletion.mutate({
                                  key,
                                  savedWorkspaceId: workspaceId,
                                  intent: lifecycle.capture(),
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Frame>
            )}
          </CardPanel>
        </Card>
      </CardFrame>

      {creating ? (
        <CreateServiceKeyDialog
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onCreated={(key) =>
            setCreated({
              key: key.key,
              name: key.name || t("settings:developerPage.unnamedKey"),
            })
          }
        />
      ) : null}

      {created ? (
        <ApiKeyCreatedModal
          apiKey={created.key}
          keyName={created.name}
          open
          onClose={() => setCreated(null)}
        />
      ) : null}

      <AlertDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:serviceKeys.revokeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:serviceKeys.revokeDescription", {
                name:
                  revoking?.name ??
                  t("settings:apiKey.table.revokeFallbackName"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() =>
                revoking &&
                revoke.mutate({
                  key: revoking,
                  savedWorkspaceId: workspaceId,
                  identity,
                  intent: lifecycle.capture(),
                })
              }
            >
              {revoke.isPending
                ? t("settings:apiKey.table.revoking")
                : t("settings:apiKey.table.revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {historyTarget && keepDialog ? (
        <ServiceKeyHistoryDialog
          target={historyTarget}
          onClose={() => setHistoryTarget(null)}
          listReady={selectedLive}
        />
      ) : null}

      {reattesting ? (
        <ReattestServiceKeyDialog
          workspaceId={workspaceId}
          apiKey={reattesting}
          historyIdentity={identity}
          captureIntent={lifecycle.capture}
          isCurrent={lifecycle.isCurrent}
          onClose={() => setReattesting(null)}
        />
      ) : null}
    </>
  );
}

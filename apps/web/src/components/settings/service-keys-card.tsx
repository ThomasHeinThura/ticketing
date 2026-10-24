import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
  Frame,
  FramePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Ban, ServerCog, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiKeyCreatedModal } from "@/components/settings/api-key-created-modal";
import {
  CreateServiceKeyDialog,
  serviceKeysKey,
} from "@/components/settings/create-service-key-dialog";
import {
  listServiceKeys,
  requestServiceKeyDeletion,
  revokeServiceKey,
} from "@/fetchers/service-keys";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { HttpError } from "@/lib/http-error";
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

/**
 * AK-1 / AK-7 / AK-11: the active workspace's service keys. The card renders only for someone
 * holding `api_key:manage`: the list route answers 403 to everyone else, and that answer, not a
 * client-side guess, hides it. Revocation is immediate; deletion is a typed-name + step-up
 * pending action approved on the pending actions screen.
 */
export function ServiceKeysCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(
    null,
  );
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const query = useQuery({
    queryKey: serviceKeysKey(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: () => listServiceKeys(workspaceId),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 403) && count < 2,
  });

  const revoke = useMutation({
    mutationFn: (key: ApiKey) => revokeServiceKey(workspaceId, key.id),
    onSuccess: async () => {
      toast.success(t("settings:serviceKeys.toastRevoked"));
      setRevoking(null);
      await queryClient.invalidateQueries({
        queryKey: serviceKeysKey(workspaceId),
      });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:serviceKeys.toastRevokeError"),
      ),
  });

  const requestDeletion = useMutation({
    mutationFn: (key: ApiKey) => requestServiceKeyDeletion(workspaceId, key.id),
    onSuccess: () => {
      toast.success(t("settings:serviceKeys.deleteRequested"));
      void navigate({ to: routes.pendingActions.path as never });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:serviceKeys.deleteFailed"),
      ),
  });

  if (!workspaceId) return null;
  if (query.error instanceof HttpError && query.error.status === 403)
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
              <Button onClick={() => setCreating(true)}>
                {t("settings:serviceKeys.create.open")}
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
        <Card className="!rounded-none">
          <CardPanel>
            {query.isLoading ? (
              <Frame>
                <FramePanel className="p-8">
                  <p className="text-center text-sm text-muted-foreground">
                    {t("settings:serviceKeys.loading")}
                  </p>
                </FramePanel>
              </Frame>
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
                    {keys.map((key) => (
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
                              onClick={() => requestDeletion.mutate(key)}
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
              onClick={() => revoking && revoke.mutate(revoking)}
            >
              {revoke.isPending
                ? t("settings:apiKey.table.revoking")
                : t("settings:apiKey.table.revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

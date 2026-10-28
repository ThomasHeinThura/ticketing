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
  Frame,
  FramePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Ban, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useRequestApiKeyDeletion from "@/hooks/mutations/api-key/use-request-api-key-deletion";
import useRevokeApiKey from "@/hooks/mutations/api-key/use-revoke-api-key";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import type { ApiKey } from "@/types/api-key";

type ApiKeyTableProps = {
  apiKeys: ApiKey[];
  isLoading: boolean;
};

function formatDate(value: Date | string | null) {
  if (!value) return "-";

  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function ApiKeyTable({ apiKeys, isLoading }: ApiKeyTableProps) {
  const { t } = useTranslation();
  const { mutateAsync: revokeApiKey } = useRevokeApiKey();
  const { mutateAsync: requestDeleteApiKey } = useRequestApiKeyDeletion();
  const openPendingAction = useOpenPendingAction();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  const getExpirationState = (expiresAt: string | null) => {
    if (!expiresAt) {
      return { label: t("common:formats.never"), isExpired: false };
    }

    const expirationDate = new Date(expiresAt);
    const isExpired = expirationDate.getTime() <= Date.now();

    return {
      label: formatDate(expirationDate),
      isExpired,
    };
  };

  const pendingRevokeKey = useMemo(
    () => apiKeys.find((key) => key.id === pendingRevokeId) ?? null,
    [apiKeys, pendingRevokeId],
  );

  const handleRevoke = async () => {
    if (!pendingRevokeKey) return;

    setRevokingId(pendingRevokeKey.id);
    try {
      await revokeApiKey(pendingRevokeKey.id);
      toast.success(t("settings:apiKey.table.toastRevoked"));
      setPendingRevokeId(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:apiKey.table.toastRevokeError"),
      );
    } finally {
      setRevokingId(null);
    }
  };

  const handleDelete = async (apiKey: ApiKey) => {
    setDeletingId(apiKey.id);
    try {
      const pending = await requestDeleteApiKey(apiKey.id);
      await openPendingAction(pending);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:apiKey.table.toastDeleteError"),
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <Frame>
        <FramePanel className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            {t("settings:apiKey.table.loading")}
          </p>
        </FramePanel>
      </Frame>
    );
  }

  if (apiKeys.length === 0) {
    return (
      <Frame>
        <FramePanel className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            {t("settings:apiKey.table.empty")}
          </p>
        </FramePanel>
      </Frame>
    );
  }

  return (
    <>
      <Frame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:apiKey.table.columnName")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnKey")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnAccess")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnLastUsed")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnCreated")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnExpires")}</TableHead>
              <TableHead className="w-[90px] min-w-[90px] text-right">
                {t("settings:apiKey.table.columnActions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.map((apiKey) => {
              const expiration = getExpirationState(apiKey.expiresAt);

              return (
                <TableRow
                  key={apiKey.id}
                  className={cn(
                    expiration.isExpired &&
                      "bg-destructive/5 hover:bg-destructive/10",
                  )}
                >
                  <TableCell
                    className={cn(
                      "font-medium",
                      expiration.isExpired && "text-destructive-foreground",
                    )}
                  >
                    <div className="flex max-w-[16rem] flex-wrap items-center gap-1">
                      <span className="break-words">
                        {apiKey.name || t("settings:apiKey.table.unnamedKey")}
                      </span>
                      {!apiKey.enabled && (
                        <Badge variant="error">
                          {t("settings:apiKey.table.revokedBadge")}
                        </Badge>
                      )}
                      {apiKey.isMcp && (
                        <Badge variant="outline">
                          {t("settings:apiKey.table.agentBadge")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-background px-2 py-1 rounded border border-border">
                      {apiKey.start}...
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={apiKey.writesEnabled ? "warning" : "outline"}
                    >
                      {apiKey.writesEnabled
                        ? t("settings:apiKey.table.accessReadWrite")
                        : t("settings:apiKey.table.accessReadOnly")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {apiKey.lastUsedAt
                      ? apiKey.lastUsedIp
                        ? t("settings:apiKey.table.lastUsedFrom", {
                            date: formatDate(apiKey.lastUsedAt),
                            ip: apiKey.lastUsedIp,
                          })
                        : formatDate(apiKey.lastUsedAt)
                      : t("settings:apiKey.table.neverUsed")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(apiKey.createdAt)}
                  </TableCell>
                  <TableCell>
                    {expiration.isExpired ? (
                      <Badge variant="error">
                        {t("settings:apiKey.table.expiredBadge", {
                          label: expiration.label,
                        })}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {expiration.label}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      {apiKey.enabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setPendingRevokeId(apiKey.id)}
                          disabled={
                            revokingId === apiKey.id || deletingId === apiKey.id
                          }
                          aria-label={t("settings:apiKey.table.revokeAria", {
                            name:
                              apiKey.name ||
                              t("settings:apiKey.table.revokeAriaFallback"),
                          })}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => void handleDelete(apiKey)}
                        disabled={
                          revokingId === apiKey.id || deletingId === apiKey.id
                        }
                        aria-label={t("settings:apiKey.table.deleteAria", {
                          name:
                            apiKey.name ||
                            t("settings:apiKey.table.unnamedKey"),
                        })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Frame>

      <AlertDialog
        open={Boolean(pendingRevokeKey)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !revokingId) {
            setPendingRevokeId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:apiKey.table.revokeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:apiKey.table.revokeConfirmDescription", {
                name:
                  pendingRevokeKey?.name ||
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
              onClick={handleRevoke}
              disabled={Boolean(revokingId)}
            >
              {revokingId
                ? t("settings:apiKey.table.revoking")
                : t("settings:apiKey.table.revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

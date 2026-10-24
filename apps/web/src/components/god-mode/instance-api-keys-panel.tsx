import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Frame,
  FramePanel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { listInstanceApiKeys } from "@/fetchers/god-mode/instance-api-keys";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

/**
 * AK-7: every API key on the instance. A service key whose creator has left is shown as
 * "created by a former member, owned by workspace administrators", so a durable credential with
 * no live owner is visible rather than silent. Read-only: revocation stays with the owner and
 * the workspace administrators.
 */
export function InstanceApiKeysPanel() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["god-mode", "api-keys"],
    queryFn: () => listInstanceApiKeys(),
    retry: false,
  });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.error instanceof HttpError && query.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("settings:instanceApiKeys.forbiddenTitle")}</AlertTitle>
        <AlertDescription>
          {t("settings:instanceApiKeys.forbiddenDescription")}
        </AlertDescription>
      </Alert>
    );
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("settings:instanceApiKeys.loadError")}</AlertTitle>
      </Alert>
    );

  const { apiKeys, hasMore } = query.data;
  if (apiKeys.length === 0)
    return (
      <Frame>
        <FramePanel className="p-8">
          <p className="text-center text-sm text-muted-foreground">
            {t("settings:instanceApiKeys.empty")}
          </p>
        </FramePanel>
      </Frame>
    );

  return (
    <div className="space-y-3">
      <Frame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings:apiKey.table.columnName")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnKey")}</TableHead>
              <TableHead>{t("settings:instanceApiKeys.columnOwner")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnAccess")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnLastUsed")}</TableHead>
              <TableHead>{t("settings:apiKey.table.columnExpires")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">
                  <div className="flex max-w-[16rem] flex-wrap items-center gap-1">
                    <span className="break-words">
                      {key.name || t("settings:apiKey.table.unnamedKey")}
                    </span>
                    {!key.enabled && (
                      <Badge variant="error">
                        {t("settings:apiKey.table.revokedBadge")}
                      </Badge>
                    )}
                    {key.isMcp && (
                      <Badge variant="outline">
                        {t("settings:apiKey.table.agentBadge")}
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
                  {key.kind === "service" ? (
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className="w-fit">
                        {t("settings:instanceApiKeys.serviceKey", {
                          workspace: key.workspaceName ?? key.workspaceId,
                        })}
                      </Badge>
                      {key.createdByFormerMember ? (
                        <Badge variant="warning" className="w-fit">
                          {t("settings:serviceKeys.formerMember")}
                        </Badge>
                      ) : null}
                    </div>
                  ) : (
                    (key.ownerName ??
                    t("settings:instanceApiKeys.unknownOwner"))
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={key.writesEnabled ? "warning" : "outline"}>
                    {key.writesEnabled
                      ? t("settings:apiKey.table.accessReadWrite")
                      : t("settings:apiKey.table.accessReadOnly")}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {key.lastUsedAt
                    ? key.lastUsedIp
                      ? t("settings:apiKey.table.lastUsedFrom", {
                          date: formatDateTime(key.lastUsedAt),
                          ip: key.lastUsedIp,
                        })
                      : formatDateTime(key.lastUsedAt)
                    : t("settings:apiKey.table.neverUsed")}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {key.expiresAt
                    ? formatDateTime(key.expiresAt)
                    : t("common:formats.never")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>
      {hasMore ? (
        <p className="text-xs text-muted-foreground">
          {t("settings:instanceApiKeys.hasMore")}
        </p>
      ) : null}
    </div>
  );
}

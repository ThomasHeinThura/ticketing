import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import {
  previewRole,
  type RoleHistoryEntry,
  type WorkspaceRoleDetail,
} from "@/fetchers/workspace-roles";
import { useRoleHistory } from "@/hooks/queries/workspace-roles/use-role-queries";
import {
  capabilityLabel,
  compareCapabilities,
  summariseCapabilities,
} from "./capability-model";

/** RL-11: "What can this role do?", the draft set as plain sentences grouped by area. */
export function RoleSummaryPanel({
  capabilities,
}: {
  capabilities: readonly string[];
}) {
  const { t } = useTranslation();
  const groups = summariseCapabilities(capabilities);
  if (groups.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("roles:summary.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("roles:summary.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {t("roles:summary.description")}
      </p>
      {groups.map((group) => (
        <Card key={group.group}>
          <CardHeader>
            <CardTitle>{group.group}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              {group.items.map((item) => (
                <li key={item.id}>{item.description}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * RL-12 "Test as this role": which navigation entries and which actions on a sample work item a
 * holder of the DRAFT set would have. A preview, not impersonation: the draft goes in the request
 * and nothing is read about, or changed for, any person.
 */
export function RolePreviewPanel({
  workspaceId,
  role,
  capabilities,
}: {
  workspaceId: string;
  role: WorkspaceRoleDetail;
  capabilities: readonly string[];
}) {
  const { t } = useTranslation();
  const preview = useQuery({
    queryKey: ["workspace-role-preview", workspaceId, role.id, capabilities],
    queryFn: () => previewRole(workspaceId, role.id, [...capabilities]),
  });
  const list = (
    title: string,
    entries: { key: string; label: string; allowed: boolean }[],
  ) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li
              className="flex items-center justify-between gap-3 py-2 text-sm"
              key={entry.key}
            >
              <span>{entry.label}</span>
              {entry.allowed ? (
                <Badge variant="success">{t("roles:preview.allowed")}</Badge>
              ) : (
                <Badge variant="outline">{t("roles:preview.denied")}</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
  return (
    <div className="space-y-4">
      <Alert variant="info">
        <AlertTitle>{t("roles:preview.notImpersonation")}</AlertTitle>
        <AlertDescription>{t("roles:preview.description")}</AlertDescription>
      </Alert>
      {preview.isLoading ? (
        <div role="status" aria-label={t("roles:preview.loading")}>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : preview.isError || !preview.data ? (
        <Alert variant="error">
          <AlertTitle>{t("roles:preview.errorTitle")}</AlertTitle>
          <AlertDescription>
            {preview.error?.message}
            <Button className="w-fit" onClick={() => void preview.refetch()}>
              <RefreshCw aria-hidden="true" />
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list(t("roles:preview.navigation"), preview.data.navigation)}
          {list(t("roles:preview.actions"), preview.data.workItemActions)}
        </div>
      )}
    </div>
  );
}

/** RL-13: the draft against another role, showing only where they differ. */
export function RoleComparePanel({
  role,
  roles,
  capabilities,
  otherId,
  onOtherChange,
}: {
  role: WorkspaceRoleDetail;
  roles: readonly WorkspaceRoleDetail[];
  capabilities: readonly string[];
  otherId: string | undefined;
  onOtherChange: (id: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const others = roles.filter((candidate) => candidate.id !== role.id);
  const other = others.find((candidate) => candidate.id === otherId);
  const rows = other
    ? compareCapabilities(capabilities, other.capabilities)
    : [];
  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-2">
        <Label htmlFor="role-compare-with">{t("roles:compare.with")}</Label>
        <PickerPopover
          id="role-compare-with"
          value={otherId}
          placeholder={t("roles:compare.choose")}
          className="w-full"
          options={others.map((candidate) => ({
            value: candidate.id,
            label: candidate.name,
          }))}
          onChange={(value) => onOtherChange(value || undefined)}
        />
      </div>
      {!other ? (
        <p className="text-muted-foreground text-sm">
          {t("roles:compare.pick")}
        </p>
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("roles:compare.sameTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("roles:compare.sameDescription", { name: other.name })}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("roles:compare.capability")}</TableHead>
              <TableHead>{role.name}</TableHead>
              <TableHead>{other.name}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium text-sm">
                    {capabilityLabel(row.id)}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {row.description}
                  </div>
                </TableCell>
                <TableCell>
                  {row.inLeft ? (
                    <Badge variant="success">{t("roles:compare.has")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("roles:compare.hasNot")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {row.inRight ? (
                    <Badge variant="success">{t("roles:compare.has")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("roles:compare.hasNot")}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function historyLabel(entry: RoleHistoryEntry): string {
  return entry.action.replace("role.", "");
}

/** RL-10: who changed which capabilities, and when. */
export function RoleHistoryPanel({
  workspaceId,
  roleId,
}: {
  workspaceId: string;
  roleId: string;
}) {
  const { t, i18n } = useTranslation();
  const history = useRoleHistory(workspaceId, roleId);
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (history.isLoading)
    return (
      <div role="status" aria-label={t("roles:history.loading")}>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (history.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("roles:history.errorTitle")}</AlertTitle>
        <AlertDescription>
          <Button className="w-fit" onClick={() => void history.refetch()}>
            <RefreshCw aria-hidden="true" />
            {t("common:actions.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!history.data?.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("roles:history.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("roles:history.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("roles:history.when")}</TableHead>
          <TableHead>{t("roles:history.who")}</TableHead>
          <TableHead>{t("roles:history.change")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.data.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap text-sm">
              {formatter.format(new Date(entry.createdAt))}
            </TableCell>
            <TableCell className="text-sm">
              {entry.actorName ?? t("roles:history.system")}
            </TableCell>
            <TableCell className="space-y-1 whitespace-normal text-sm">
              <div className="font-medium">
                {t(`roles:history.actions.${historyLabel(entry)}`, {
                  defaultValue: entry.action,
                })}
              </div>
              {entry.added.length > 0 ? (
                <div>
                  <span className="text-muted-foreground">
                    {t("roles:history.added")}{" "}
                  </span>
                  {entry.added.map(capabilityLabel).join(", ")}
                </div>
              ) : null}
              {entry.removed.length > 0 ? (
                <div>
                  <span className="text-muted-foreground">
                    {t("roles:history.removed")}{" "}
                  </span>
                  {entry.removed.map(capabilityLabel).join(", ")}
                </div>
              ) : null}
              {entry.rank ? (
                <div>
                  {entry.rank.before === null
                    ? t("roles:history.rankSet", {
                        after: entry.rank.after ?? "-",
                      })
                    : t("roles:history.rank", {
                        before: entry.rank.before,
                        after: entry.rank.after ?? "-",
                      })}
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

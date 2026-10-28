import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import PageTitle from "@/components/page-title";
import { useInstanceAudit } from "@/hooks/queries/god-mode/use-instance-audit";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import { parseInstanceAuditSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/audit",
)({ validateSearch: parseInstanceAuditSearch, component: GodModeAuditRoute });

function GodModeAuditRoute() {
  const { t } = useTranslation();
  const isAdmin = useInstanceAdminSignal();
  const { action: actionFilter, limit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const query = useInstanceAudit(isAdmin, {
    limit,
    action: actionFilter.trim() || undefined,
  });

  if (!isAdmin) {
    return (
      <>
        <PageTitle
          title={t("common:navigation.auditLog", { defaultValue: "Audit log" })}
        />
        <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
          <h1 className="text-2xl font-semibold">
            {t("common:navigation.auditLog", { defaultValue: "Audit log" })}
          </h1>
          <IdentityAccessDenied />
        </div>
      </>
    );
  }

  const rows = query.data?.rows ?? [];

  return (
    <>
      <PageTitle
        title={t("common:navigation.auditLog", { defaultValue: "Audit log" })}
      />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            {t("common:navigation.auditLog", { defaultValue: "Audit log" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("common:audit.description", {
              defaultValue:
                "Immutable trail of instance-wide administrative, security, and lifecycle events.",
            })}
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64">
            <Input
              placeholder={t("common:audit.filterAction", {
                defaultValue: "Filter by action…",
              })}
              value={actionFilter}
              onChange={(e) =>
                void navigate({
                  search: { action: e.target.value, limit },
                  replace: true,
                })
              }
              aria-label={t("common:audit.filterAction", {
                defaultValue: "Filter by action…",
              })}
            />
          </div>
          <div className="w-32">
            <PickerPopover
              value={String(limit)}
              onChange={(val) =>
                void navigate({
                  search: { action: actionFilter, limit: Number(val) || 50 },
                })
              }
              ariaLabel={t("common:audit.limit", {
                defaultValue: "Row limit",
              })}
              className="w-full"
              options={[
                { value: "25", label: t("common:audit.rows", { count: 25 }) },
                { value: "50", label: t("common:audit.rows", { count: 50 }) },
                { value: "100", label: t("common:audit.rows", { count: 100 }) },
              ]}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {t("common:actions.refresh", { defaultValue: "Refresh" })}
          </Button>
        </div>

        {query.isError ? (
          <Alert variant="error">
            <AlertTitle>
              {t("common:error.title", {
                defaultValue: "Failed to load audit records",
              })}
            </AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                {query.error?.message || t("common:audit.loadFailed")}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                {t("common:actions.tryAgain", { defaultValue: "Try again" })}
              </Button>
            </AlertDescription>
          </Alert>
        ) : query.isLoading ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-8">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {t("common:audit.emptyTitle", {
                      defaultValue: "No audit events found",
                    })}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("common:audit.emptyDescription", {
                      defaultValue:
                        "No matching actions recorded in the selected window.",
                    })}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common:audit.columns.timestamp")}</TableHead>
                  <TableHead>{t("common:audit.columns.action")}</TableHead>
                  <TableHead>{t("common:audit.columns.entity")}</TableHead>
                  <TableHead>{t("common:audit.columns.actor")}</TableHead>
                  <TableHead>{t("common:audit.columns.workspace")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Badge variant="outline">{row.action}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {row.entityType}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({row.entityId})
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.actorType}
                      {row.actorId ? (
                        <span className="ml-1 text-muted-foreground">
                          ({row.actorId.slice(0, 8)}…)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.workspaceId ? row.workspaceId.slice(0, 8) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}

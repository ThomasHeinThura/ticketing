import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import { useCallerRoleAuthority } from "@/hooks/use-caller-role-authority";
import { routes } from "@/lib/routes";
import { CreateRoleDialog } from "./create-role-dialog";

/** `docs/screens.md` "Workspace — roles": name, description, rank, holders, system badge. */
export function RolesList() {
  const { t, i18n } = useTranslation();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const roles = useWorkspaceRoles(workspace?.id);
  const authority = useCallerRoleAuthority(workspace?.id);
  const [creating, setCreating] = useState(false);
  const loading = workspaceLoading || roles.isLoading;
  const formatDate = (value: Date | string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
          new Date(value),
        )
      : "";
  return (
    <>
      <PageTitle title={t("roles:list.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("roles:list.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("roles:list.description")}
            </p>
          </div>
          {authority.canManageRoles ? (
            <Button onClick={() => setCreating(true)} disabled={!workspace}>
              <Plus aria-hidden="true" />
              {t("roles:list.new")}
            </Button>
          ) : null}
        </div>
        {loading ? (
          <div
            role="status"
            aria-label={t("roles:list.loading")}
            className="space-y-3"
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : roles.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("roles:list.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("roles:list.loadErrorDescription")}
              <Button className="w-fit" onClick={() => void roles.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : roles.data?.length ? (
          <CardFrame>
            {roles.data.map((role) => (
              <Card key={role.id}>
                <CardHeader>
                  <CardTitle className="truncate">
                    <Link
                      className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={routes.workspaceRoleDetail.path}
                      params={{ id: role.id }}
                    >
                      {role.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {role.description ? `${role.description} · ` : ""}
                    {t("roles:list.rank", { rank: role.rank })}
                    {" · "}
                    {t("roles:list.holders", { count: role.holderCount })}
                    {role.updatedAt
                      ? ` · ${t("roles:list.modified", { date: formatDate(role.updatedAt) })}`
                      : ""}
                  </CardDescription>
                  <CardAction className="flex flex-wrap items-center gap-2">
                    {role.isSystem ? (
                      <Badge variant="info">{t("roles:badges.system")}</Badge>
                    ) : (
                      <Badge variant="secondary">
                        {t("roles:badges.custom")}
                      </Badge>
                    )}
                    {!role.isEditable ? (
                      <Badge variant="outline">
                        {t("roles:badges.notEditable")}
                      </Badge>
                    ) : null}
                  </CardAction>
                </CardHeader>
              </Card>
            ))}
          </CardFrame>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("roles:list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("roles:list.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {creating && workspace ? (
        <CreateRoleDialog
          workspaceId={workspace.id}
          roles={roles.data ?? []}
          callerRank={authority.rank}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}

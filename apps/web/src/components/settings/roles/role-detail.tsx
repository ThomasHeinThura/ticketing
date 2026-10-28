import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@taskdesk/ui";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import type { WorkspaceRoleDetail } from "@/fetchers/workspace-roles";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import {
  roleDetailKey,
  useRole,
} from "@/hooks/queries/workspace-roles/use-role-queries";
import { useCallerRoleAuthority } from "@/hooks/use-caller-role-authority";
import {
  type RoleDetailSearch,
  type RoleDetailTab,
  routes,
} from "@/lib/routes";
import { RoleCapabilitiesPanel } from "./role-capabilities-panel";
import { useRoleDraft } from "./role-draft";
import {
  RoleComparePanel,
  RoleHistoryPanel,
  RolePreviewPanel,
  RoleSummaryPanel,
} from "./role-insight-panels";
import { RolePeoplePanel } from "./role-people-panel";

function RoleWorkspace({
  workspaceId,
  role,
  search,
  onSearchChange,
  onReload,
}: {
  workspaceId: string;
  role: WorkspaceRoleDetail;
  search: RoleDetailSearch;
  onSearchChange: (next: RoleDetailSearch) => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const roles = useWorkspaceRoles(workspaceId);
  const authority = useCallerRoleAuthority(workspaceId);
  const state = useRoleDraft(role);
  const tab: RoleDetailTab = search.tab ?? "capabilities";
  return (
    <Tabs
      value={tab}
      onValueChange={(value) =>
        onSearchChange({
          ...search,
          tab: value === "capabilities" ? undefined : (value as RoleDetailTab),
        })
      }
    >
      <TabsList variant="underline">
        <TabsTab value="capabilities">{t("roles:tabs.capabilities")}</TabsTab>
        <TabsTab value="summary">{t("roles:tabs.summary")}</TabsTab>
        <TabsTab value="preview">{t("roles:tabs.preview")}</TabsTab>
        <TabsTab value="compare">{t("roles:tabs.compare")}</TabsTab>
        <TabsTab value="people">{t("roles:tabs.people")}</TabsTab>
        <TabsTab value="history">{t("roles:tabs.history")}</TabsTab>
      </TabsList>
      <TabsPanel className="pt-4" value="capabilities">
        <RoleCapabilitiesPanel
          workspaceId={workspaceId}
          role={role}
          authority={authority}
          state={state}
          onReload={onReload}
        />
      </TabsPanel>
      <TabsPanel className="pt-4" value="summary">
        <RoleSummaryPanel capabilities={state.effective} />
      </TabsPanel>
      <TabsPanel className="pt-4" value="preview">
        {tab === "preview" ? (
          <RolePreviewPanel
            workspaceId={workspaceId}
            role={role}
            capabilities={state.effective}
          />
        ) : null}
      </TabsPanel>
      <TabsPanel className="pt-4" value="compare">
        <RoleComparePanel
          role={role}
          roles={roles.data ?? []}
          capabilities={state.effective}
          otherId={search.compare}
          onOtherChange={(compare) =>
            onSearchChange({ ...search, tab: "compare", compare })
          }
        />
      </TabsPanel>
      <TabsPanel className="pt-4" value="people">
        <RolePeoplePanel
          workspaceId={workspaceId}
          role={role}
          roles={roles.data ?? []}
          callerRank={authority.rank}
          canManageMembers={authority.canManageMembers}
          canManageRoles={authority.canManageRoles}
        />
      </TabsPanel>
      <TabsPanel className="pt-4" value="history">
        {tab === "history" ? (
          <RoleHistoryPanel workspaceId={workspaceId} roleId={role.id} />
        ) : null}
      </TabsPanel>
    </Tabs>
  );
}

/** `docs/screens.md` "Role editor": capabilities, summary, preview, comparison, people, history. */
export function RoleDetailView({
  roleId,
  search,
  onSearchChange,
}: {
  roleId: string;
  search: RoleDetailSearch;
  onSearchChange: (next: RoleDetailSearch) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const role = useRole(workspace?.id ?? "", roleId);
  return (
    <>
      <PageTitle title={role.data?.name ?? t("roles:detail.pageTitle")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-2">
          <Button
            render={<Link to={routes.workspaceRoles.path} />}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft aria-hidden="true" />
            {t("roles:detail.allRoles")}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {role.data?.name ?? t("roles:detail.pageTitle")}
            </h1>
            {role.data ? (
              <>
                {role.data.isSystem ? (
                  <Badge variant="info">{t("roles:badges.system")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("roles:badges.custom")}</Badge>
                )}
                <Badge variant="outline">
                  {t("roles:list.rank", { rank: role.data.rank })}
                </Badge>
              </>
            ) : null}
          </div>
        </div>
        {workspaceLoading || role.isLoading ? (
          <div role="status" aria-label={t("roles:detail.loading")}>
            <Skeleton className="h-48 w-full" />
          </div>
        ) : role.isError || !role.data || !workspace ? (
          <Alert variant="error">
            <AlertTitle>{t("roles:detail.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("roles:detail.loadErrorDescription")}
              <Button className="w-fit" onClick={() => void role.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <RoleWorkspace
            // A fresh draft for every saved version: a save, or a reload after a conflict.
            key={`${role.data.id}:${role.data.version}`}
            workspaceId={workspace.id}
            role={role.data}
            search={search}
            onSearchChange={onSearchChange}
            onReload={() =>
              void queryClient.invalidateQueries({
                queryKey: roleDetailKey(workspace.id, role.data.id),
              })
            }
          />
        )}
      </div>
    </>
  );
}

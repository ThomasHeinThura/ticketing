import { useNavigate } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetWorkspaces from "@/hooks/queries/workspace/use-get-workspaces";
import { activateWorkspaceForNavigation } from "@/lib/activate-workspace-for-navigation";
import { authClient } from "@/lib/auth-client";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";
import { toast } from "@/lib/toast";

export default function WorkspaceCrumbSelect({
  workspaceId,
}: {
  workspaceId?: string;
} = {}) {
  const { t } = useTranslation();
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: workspaces } = useGetWorkspaces();
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const workspace = workspaceId
    ? (workspaces?.find((candidate) => candidate.id === workspaceId) ??
      (activeWorkspace?.id === workspaceId ? activeWorkspace : undefined))
    : activeWorkspace;

  return (
    <Button
      aria-label={`${t("navigation:sidebar.overview")}: ${workspace?.name ?? t("navigation:workspaceSwitcher.selectWorkspace")}`}
      variant="ghost"
      size="xs"
      className="h-7 min-w-0 max-w-32 shrink justify-between px-2 text-xs text-foreground"
      onClick={() => {
        const sessionWorkspaceId = getActiveOrganizationId(session);
        if (workspaceId && workspaceId !== sessionWorkspaceId) {
          if (
            workspaces &&
            !workspaces.some((candidate) => candidate.id === workspaceId)
          ) {
            toast.error(t("navigation:workspaceSwitcher.switchFailed"));
            return;
          }
          void activateWorkspaceForNavigation(workspaceId).then(
            () => navigate({ to: "/agent" }),
            () => {
              toast.error(t("navigation:workspaceSwitcher.switchFailed"));
            },
          );
          return;
        }
        void navigate({ to: "/agent" });
      }}
    >
      <span className="min-w-0 truncate text-left">
        {workspace?.name || t("navigation:workspaceSwitcher.selectWorkspace")}
      </span>
    </Button>
  );
}

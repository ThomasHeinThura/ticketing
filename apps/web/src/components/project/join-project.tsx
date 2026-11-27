import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { joinProject } from "@/fetchers/project-member/project-members";
import { toast } from "@/lib/toast";
import { auditEntity } from "@/query-client/audit-invalidation";

/** Eligibility is supplied by the server's validated workspace-role reach flag. */
export function JoinProject({
  projectId,
  workspaceId,
  canJoin = false,
  projectName,
  compact = false,
}: {
  projectId: string;
  workspaceId: string;
  canJoin?: boolean;
  /** Names the button for assistive tech ("Join Customer Support"). */
  projectName?: string;
  /** List rows: only a small Join button, no membership text. */
  compact?: boolean;
}) {
  const { t } = useTranslation("workspace");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (_: { projectId: string; workspaceId: string }) =>
      joinProject(projectId),
    // The answered roster names the caller's new direct row.
    meta: {
      audits: {
        targets: (
          v: { projectId: string; workspaceId: string },
          roster?: {
            members?: { membershipId: string | null; source: string }[];
          },
        ) =>
          (roster?.members ?? []).flatMap((m) =>
            m.source === "direct" && m.membershipId
              ? auditEntity("project_membership", m.membershipId, {
                  kind: "project",
                  ...v,
                })
              : [],
          ),
      },
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => toast.error(t("projects.joinFailed")),
  });
  if (mutation.isSuccess || (compact && !canJoin)) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {compact ? null : (
        <span className="text-muted-foreground text-xs">
          {t("projects.notMember")}
        </span>
      )}
      {canJoin ? (
        <Button
          variant={compact ? "ghost" : "outline"}
          size="sm"
          aria-label={
            compact && projectName
              ? t("projects.joinNamed", { name: projectName })
              : undefined
          }
          disabled={mutation.isPending}
          onClick={(event) => {
            event.stopPropagation();
            mutation.mutate({ projectId, workspaceId });
          }}
        >
          {t(
            mutation.isPending
              ? "projects.joining"
              : compact
                ? "projects.joinShort"
                : "projects.join",
          )}
        </Button>
      ) : null}
    </span>
  );
}

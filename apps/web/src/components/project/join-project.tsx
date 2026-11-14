import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { joinProject } from "@/fetchers/project-member/project-members";
import { toast } from "@/lib/toast";

/** Eligibility is supplied by the server's validated workspace-role reach flag. */
export function JoinProject({
  projectId,
  canJoin = false,
}: {
  projectId: string;
  canJoin?: boolean;
}) {
  const { t } = useTranslation("workspace");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => joinProject(projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => toast.error(t("projects.joinFailed")),
  });
  if (mutation.isSuccess) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-muted-foreground text-xs">
        {t("projects.notMember")}
      </span>
      {canJoin ? (
        <Button
          variant="outline"
          size="sm"
          disabled={mutation.isPending}
          onClick={(event) => {
            event.stopPropagation();
            mutation.mutate();
          }}
        >
          {t(mutation.isPending ? "projects.joining" : "projects.join")}
        </Button>
      ) : null}
    </span>
  );
}

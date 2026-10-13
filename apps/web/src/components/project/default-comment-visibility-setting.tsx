import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

const VISIBILITIES = ["internal", "public"] as const;
type CommentVisibility = (typeof VISIBILITIES)[number];

function isCommentVisibility(value: unknown): value is CommentVisibility {
  return value === "internal" || value === "public";
}

/**
 * CA-2: the project's default comment visibility, the value the work-item comment
 * composer starts on. Rendered only for callers holding the STRICT `manageProjectSettings`
 * capability (the server's `project:manage_settings`); the server enforces the same rule on
 * `PUT /api/project/{id}` when the field is sent, so hiding the control is only the UI half.
 */
function DefaultCommentVisibilitySetting({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canManageProjectSettings, canManageProjects } =
    useWorkspacePermission();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { mutateAsync: updateProject, isPending } = useUpdateProject();

  if (!canManageProjectSettings()) return null;

  const current: CommentVisibility = isCommentVisibility(
    project?.defaultCommentVisibility,
  )
    ? project.defaultCommentVisibility
    : "internal";

  const handleChange = async (value: unknown) => {
    if (!project || !isCommentVisibility(value) || value === current) return;
    try {
      await updateProject({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description ?? "",
        icon: project.icon ?? "Layout",
        defaultCommentVisibility: value,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        // Open work items read the project default through the item payload.
        queryClient.invalidateQueries({ queryKey: ["work-items"] }),
      ]);
      toast.success(t("settings:projectGeneral.toastUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectGeneral.toastUpdateError"),
      );
    }
  };

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-0.5">
          <label
            htmlFor="project-default-comment-visibility"
            className="text-sm font-medium"
          >
            {t("settings:projectGeneral.defaultCommentVisibilityLabel")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("settings:projectGeneral.defaultCommentVisibilityHint")}
          </p>
        </div>
        <Select
          items={VISIBILITIES.map((value) => ({
            value,
            label: t(`activity:timeline.${value}`),
          }))}
          value={current}
          disabled={!project || isPending || !canManageProjects()}
          onValueChange={handleChange}
        >
          <SelectTrigger
            id="project-default-comment-visibility"
            data-testid="default-comment-visibility-select"
            className="w-full sm:w-64"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISIBILITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`activity:timeline.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

export default DefaultCommentVisibilitySetting;

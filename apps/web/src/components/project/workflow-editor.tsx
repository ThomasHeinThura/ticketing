import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useDelayedPending,
} from "@taskdesk/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useUpsertWorkflowRule } from "@/hooks/mutations/workflow-rule/use-upsert-workflow-rule";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useGetWorkflowRules } from "@/hooks/queries/workflow-rule/use-get-workflow-rules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

const GITHUB_EVENT_TYPES = [
  "branch_push",
  "pr_opened",
  "pr_merged",
  "issue_opened",
  "issue_closed",
] as const;

type WorkflowEditorProps = {
  projectId: string;
};

export default function WorkflowEditor({ projectId }: WorkflowEditorProps) {
  const { t } = useTranslation();
  const idPrefix = useId();
  const { data: columns, isLoading: columnsLoading } = useGetColumns(projectId);
  const { data: rules, isLoading: rulesLoading } =
    useGetWorkflowRules(projectId);
  const { mutateAsync: upsertRule } = useUpsertWorkflowRule();
  // `PUT /api/workflow-rule/{projectId}` needs project:manage_settings (A8-2). Without it the
  // pickers are shown read-only (and stay disabled while the check runs), so a pick never ends
  // in a 403.
  const { canManageProjectSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const canEdit = !isCheckingPermissions && canManageProjectSettings();
  const placeholderVisible = useDelayedPending(columnsLoading || rulesLoading);

  if (columnsLoading || rulesLoading || placeholderVisible) {
    return (
      <div
        className="text-sm text-muted-foreground"
        style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
      >
        {t("settings:workflowEditor.loading")}
      </div>
    );
  }

  if (!columns || columns.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("settings:workflowEditor.createColumnsFirst")}
      </div>
    );
  }

  const renderRuleSection = (
    integrationType: "github" | "gitea",
    headingKey: "githubHeading" | "giteaHeading",
    hintKey: "githubHint" | "giteaHint",
  ) => {
    const sectionId = `${idPrefix}-${integrationType}-heading`;
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 id={sectionId} className="text-sm font-medium">
            {t(`settings:workflowEditor.${headingKey}`)}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(`settings:workflowEditor.${hintKey}`)}
          </p>
        </div>

        <div className="space-y-2">
          {GITHUB_EVENT_TYPES.map((eventType) => {
            const currentRule = rules?.find(
              (r) =>
                r.integrationType === integrationType &&
                r.eventType === eventType,
            );

            const rowId = `${idPrefix}-${integrationType}-${eventType}`;
            return (
              <div
                key={`${integrationType}-${eventType}`}
                className="flex items-center justify-between gap-4 p-3 border border-border rounded-md bg-sidebar"
              >
                <span id={`${rowId}-event`} className="text-sm">
                  {t(`settings:workflowEditor.events.${eventType}`)}
                </span>
                <Select
                  value={currentRule?.columnId ?? ""}
                  disabled={!canEdit}
                  onValueChange={async (value) => {
                    if (!value || !canEdit) return;
                    try {
                      await upsertRule({
                        projectId,
                        data: {
                          integrationType,
                          eventType,
                          columnId: value,
                        },
                      });
                      toast.success(t("settings:workflowEditor.toastUpdated"));
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : t("settings:workflowEditor.toastError"),
                      );
                    }
                  }}
                >
                  <SelectTrigger
                    // Name = section + event + the visible value (WCAG 2.5.3).
                    aria-labelledby={`${sectionId} ${rowId}-event ${rowId}-value`}
                    className="w-48 h-8 text-sm"
                  >
                    <SelectValue
                      id={`${rowId}-value`}
                      placeholder={t(
                        "settings:workflowEditor.selectColumnPlaceholder",
                      )}
                    >
                      {columns.find((c) => c.id === currentRule?.columnId)
                        ?.name ??
                        t("settings:workflowEditor.selectColumnPlaceholder")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        {col.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-10">
      {!canEdit && !isCheckingPermissions ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="workflow-rules-read-only"
        >
          {t("settings:workflowEditor.readOnly")}
        </p>
      ) : null}
      {renderRuleSection("github", "githubHeading", "githubHint")}
      {renderRuleSection("gitea", "giteaHeading", "giteaHint")}
    </div>
  );
}

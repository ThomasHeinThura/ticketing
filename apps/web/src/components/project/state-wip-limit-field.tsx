import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EntityHistoryButton } from "@/components/settings/entity-history-button";
import { setWipLimit } from "@/fetchers/agile";
import useWipLimits from "@/hooks/queries/agile/use-wip-limits";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { toast } from "@/lib/toast";
import { auditEntity } from "@/query-client/audit-invalidation";

/**
 * `VW-12`: the optional work-in-progress limit of one board column (a project state), set from
 * the project's states settings by someone who can manage project settings. The board turns the
 * column count amber when it is exceeded; nothing is blocked. The server answers who may set it.
 */
export default function StateWipLimitField({
  projectId,
  workspaceId,
  stateId,
  stateName,
}: {
  projectId: string;
  workspaceId: string;
  stateId: string;
  stateName: string;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const { data: projects } = useGetProjects({ workspaceId });
  const projectKey = projects?.find(
    (project) => project.id === projectId,
  )?.slug;
  const { limits, canManage } = useWipLimits(projectKey);
  const stored = limits.get(stateId) ?? null;
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const value = draft === undefined ? stored : draft;
  const save = useMutation({
    mutationFn: (v: {
      limit: number | null;
      stateId: string;
      projectId: string;
      workspaceId: string;
    }) => setWipLimit(projectKey as string, v.stateId, v.limit),
    meta: {
      audits: {
        targets: (v: {
          stateId: string;
          projectId: string;
          workspaceId: string;
        }) =>
          auditEntity("state", v.stateId, {
            kind: "project",
            workspaceId: v.workspaceId,
            projectId: v.projectId,
          }),
      },
    },
    onSuccess: async () => {
      setDraft(undefined);
      toast.success(t("settings:projectStates.wip.saved", { name: stateName }));
      await cache.invalidateQueries({ queryKey: ["agile", "wip-limits"] });
    },
    onError: () => toast.error(t("settings:projectStates.wip.failed")),
  });
  if (!projectKey || !canManage) return null;
  const dirty = value !== stored;
  return (
    <div className="flex items-center gap-1">
      <NumberField
        size="sm"
        min={1}
        max={1000}
        step={1}
        value={value}
        onValueChange={(next) => setDraft(next ?? null)}
        className="w-28"
      >
        <NumberFieldGroup>
          <NumberFieldInput
            aria-label={t("settings:projectStates.wip.label", {
              name: stateName,
            })}
            placeholder={t("settings:projectStates.wip.none")}
          />
        </NumberFieldGroup>
      </NumberField>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7"
        disabled={!dirty || save.isPending}
        onClick={() =>
          save.mutate({ limit: value ?? null, stateId, projectId, workspaceId })
        }
      >
        {value === null
          ? t("settings:projectStates.wip.clear")
          : t("settings:projectStates.wip.save")}
      </Button>
      <EntityHistoryButton
        name={stateName}
        target={{
          kind: "entity",
          type: "state",
          id: stateId,
          scope: { kind: "project", workspaceId, projectId },
        }}
      />
    </div>
  );
}

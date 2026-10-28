import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@taskdesk/ui";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { NamedOption } from "@/components/workflow/workflow-add-transition-dialog";
import {
  applyCabTemplate,
  CabTemplateStrandedError,
  getCabTemplateStatus,
} from "@/fetchers/service-management";
import { toast } from "@/lib/toast";

/**
 * CH-2: the opt-in "CAB approval for changes" template on the Kaneo workflow settings screen.
 * One action; never applied on its own. The chosen projects adopt the Approved state.
 */
export function CabTemplatePanel({
  workspaceId,
  canManage,
  projects,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
  projects: NamedOption[];
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const status = useQuery({
    queryKey: ["cab-template", workspaceId],
    queryFn: () => getCabTemplateStatus(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
  const apply = useMutation({
    mutationFn: () => applyCabTemplate(workspaceId ?? "", selected),
    onSuccess: async () => {
      toast.success(t("settings:workflows.cabTemplate.applied"));
      setOpen(false);
      setSelected([]);
      await cache.invalidateQueries({ queryKey: ["cab-template"] });
      await cache.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
  if (!workspaceId || status.isLoading) return null;
  if (status.isError)
    return (
      <Alert variant="error">
        <AlertDescription>
          {t("settings:workflows.cabTemplate.loadFailed")}
        </AlertDescription>
      </Alert>
    );
  const applied = status.data?.applied === true;
  if (!canManage && !applied) return null;
  const adopted = new Set(status.data?.adoptedProjectIds ?? []);
  const unadopted = projects.filter((project) => !adopted.has(project.id));
  const error = apply.error;
  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 font-semibold text-base">
              <ShieldCheck aria-hidden="true" className="size-4" />
              {applied
                ? t("settings:workflows.cabTemplate.appliedTitle")
                : t("settings:workflows.cabTemplate.title")}
            </h2>
            <p className="max-w-2xl text-muted-foreground text-sm">
              {applied
                ? t("settings:workflows.cabTemplate.appliedDescription")
                : t("settings:workflows.cabTemplate.description")}
            </p>
            {applied && unadopted.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("settings:workflows.cabTemplate.unadopted", {
                  names: unadopted.map((project) => project.name).join(", "),
                })}
              </p>
            ) : null}
          </div>
          {canManage && (!applied || unadopted.length > 0) ? (
            <Button
              variant={applied ? "outline" : "default"}
              onClick={() => {
                apply.reset();
                setSelected([]);
                setOpen(true);
              }}
            >
              {applied
                ? t("settings:workflows.cabTemplate.actionMore")
                : t("settings:workflows.cabTemplate.action")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!apply.isPending) setOpen(next);
        }}
      >
        <DialogContent closeLabel={t("common:actions.close")}>
          <DialogHeader>
            <DialogTitle>
              {t("settings:workflows.cabTemplate.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings:workflows.cabTemplate.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6">
            <p className="font-medium text-sm">
              {t("settings:workflows.cabTemplate.projects")}
            </p>
            {(applied ? unadopted : projects).map((project) => (
              <div key={project.id} className="flex items-center gap-2">
                <Checkbox
                  id={`cab-project-${project.id}`}
                  checked={selected.includes(project.id)}
                  disabled={apply.isPending}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked
                        ? [...selected, project.id]
                        : selected.filter((id) => id !== project.id),
                    )
                  }
                />
                <Label
                  htmlFor={`cab-project-${project.id}`}
                  className="font-normal"
                >
                  {project.name}
                </Label>
              </div>
            ))}
            {error ? (
              <Alert variant="error">
                <AlertTitle>
                  {error instanceof CabTemplateStrandedError
                    ? t("settings:workflows.cabTemplate.strandedTitle")
                    : t("settings:workflows.errorTitle")}
                </AlertTitle>
                <AlertDescription>
                  {error instanceof CabTemplateStrandedError
                    ? t("settings:workflows.cabTemplate.stranded", {
                        names: error.projects
                          .map((project) => project.name)
                          .join(", "),
                      })
                    : t("settings:workflows.cabTemplate.failed")}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={apply.isPending}
              onClick={() => setOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              disabled={apply.isPending || selected.length === 0}
              onClick={() => apply.mutate()}
            >
              {t("settings:workflows.cabTemplate.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Label,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ProjectStatus,
  type SummaryInput,
  updateProjectSummary,
} from "@/fetchers/project/overview";
import { toast } from "@/lib/toast";
import {
  OptionSelect,
  useFailureMessage,
  useRefreshOverview,
} from "./overview-shared";

const STATUSES: ProjectStatus[] = ["planning", "active", "on_hold", "closed"];

type SummaryValues = {
  objective: string | null;
  inScope: string | null;
  outOfScope: string | null;
  successCriteria: string | null;
  statusNote: string | null;
  status: string;
};

const TEXT_FIELDS = [
  ["objective", 4000],
  ["inScope", 4000],
  ["outOfScope", 4000],
  ["successCriteria", 4000],
  ["statusNote", 2000],
] as const;

/**
 * Edit the project summary and lifecycle status (`PATCH /api/project/{id}/summary`,
 * `project:update`). Only changed fields are sent; the server stamps the status note time.
 */
export function EditSummaryDialog({
  projectId,
  initial,
  onClose,
}: {
  projectId: string;
  initial: SummaryValues;
  onClose: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const [values, setValues] = useState<SummaryValues>(initial);
  const [problem, setProblem] = useState<string | null>(null);

  const changes = (): SummaryInput => {
    const body: SummaryInput = {};
    for (const [field] of TEXT_FIELDS) {
      const next = (values[field] ?? "").trim();
      if (next !== (initial[field] ?? "")) body[field] = next || null;
    }
    if (values.status !== initial.status)
      body.status = values.status as ProjectStatus;
    return body;
  };

  const save = useMutation({
    mutationFn: () => updateProjectSummary(projectId, changes()),
    onSuccess: async () => {
      await refresh();
      toast.success(t("editSummary.saved"));
      onClose();
    },
    onError: (error) => setProblem(failure(error)),
  });

  const dirty = Object.keys(changes()).length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-xl" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("editSummary.title")}</DialogTitle>
          <DialogDescription>{t("editSummary.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="summary-status">{t("summary.status")}</Label>
            <OptionSelect
              id="summary-status"
              className="w-full sm:w-56"
              value={values.status as ProjectStatus}
              options={STATUSES.map((status) => ({
                value: status,
                label: t(`status.${status}`),
              }))}
              onChange={(status) =>
                setValues((current) => ({ ...current, status }))
              }
            />
          </div>
          {TEXT_FIELDS.map(([field, max]) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Label htmlFor={`summary-${field}`}>
                {t(`summary.${field}`)}
              </Label>
              <Textarea
                id={`summary-${field}`}
                value={values[field] ?? ""}
                maxLength={max}
                rows={field === "statusNote" ? 2 : 3}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          {problem ? (
            <Alert variant="error">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {t("editSummary.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

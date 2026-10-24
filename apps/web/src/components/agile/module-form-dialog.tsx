import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerSelect } from "@/components/automation/picker-select";
import {
  createModule,
  type LeadCandidate,
  MODULE_STATES,
  type ModuleRow,
  type ModuleState,
  updateModule,
} from "@/fetchers/agile";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

const NO_LEAD = "__none__";

/** Create or edit a module (`MO-1`): name, lead, optional target date and a status. */
export function ModuleFormDialog({
  projectKey,
  module,
  leadCandidates,
  onClose,
}: {
  projectKey: string;
  module?: ModuleRow;
  leadCandidates: LeadCandidate[];
  onClose: () => void;
}) {
  const { t } = useTranslation("agile");
  const cache = useQueryClient();
  const [name, setName] = useState(module?.name ?? "");
  const [description, setDescription] = useState(module?.description ?? "");
  const [leadId, setLeadId] = useState(module?.lead?.id ?? NO_LEAD);
  const [state, setState] = useState<ModuleState>(module?.state ?? "planned");
  const [targetDate, setTargetDate] = useState(module?.targetDate ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const leadOptions = [
    { value: NO_LEAD, label: t("modules.form.noLead") },
    ...leadCandidates.map((person) => ({
      value: person.id,
      label: person.name,
    })),
    ...(module?.lead && !leadCandidates.some((p) => p.id === module.lead?.id)
      ? [{ value: module.lead.id, label: module.lead.name ?? module.lead.id }]
      : []),
  ];

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        leadId: leadId === NO_LEAD ? null : leadId,
        state,
        targetDate: targetDate === "" ? null : targetDate,
      };
      return module
        ? updateModule(module.id, { ...input, version: module.version })
        : createModule(projectKey, input);
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["agile"] });
      toast.success(t(module ? "modules.form.saved" : "modules.form.created"));
      onClose();
    },
    onError: (error) =>
      setProblem(
        error instanceof HttpError && error.status === 409
          ? t("modules.form.versionConflict")
          : t("modules.form.saveFailed"),
      ),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {module
              ? t("modules.form.editTitle")
              : t("modules.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("modules.form.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="module-name">{t("modules.form.name")}</Label>
            <Input
              id="module-name"
              value={name}
              maxLength={120}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="module-description">
              {t("modules.form.descriptionLabel")}
            </Label>
            <Textarea
              id="module-description"
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="module-lead">{t("modules.form.lead")}</Label>
              <PickerSelect
                id="module-lead"
                value={leadId}
                options={leadOptions}
                placeholder={t("modules.form.noLead")}
                onChange={setLeadId}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="module-state">{t("modules.form.state")}</Label>
              <PickerSelect
                id="module-state"
                value={state}
                options={MODULE_STATES.map((value) => ({
                  value,
                  label: t(`modules.state.${value}`),
                }))}
                placeholder={t("modules.form.state")}
                onChange={(value) => setState(value as ModuleState)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="module-target">{t("modules.form.target")}</Label>
            <Input
              id="module-target"
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </div>
          {problem ? (
            <Alert variant="error">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={name.trim() === "" || save.isPending}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {module ? t("common.save") : t("modules.form.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

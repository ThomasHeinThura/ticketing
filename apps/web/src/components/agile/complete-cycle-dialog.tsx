import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CycleDetail,
  completeCycle,
  INCOMPLETE_POLICIES,
  type IncompletePolicy,
} from "@/fetchers/agile";
import { toast } from "@/lib/toast";

/**
 * `CY-6`: what happens to the incomplete items is chosen at completion, with the project's
 * default pre-selected. "Next cycle" is not offered when there is no later cycle. The summary
 * under the choices is the API's own dry run, so the planner sees the effect before confirming.
 * Completing with everything incomplete is allowed.
 */
export function CompleteCycleDialog({
  cycle,
  onClose,
}: {
  cycle: CycleDetail;
  onClose: () => void;
}) {
  const { t } = useTranslation("agile");
  const cache = useQueryClient();
  const { defaultPolicy, nextCycle, incompleteCount } = cycle.completionPreview;
  const initial: IncompletePolicy =
    defaultPolicy === "next_cycle" && !nextCycle ? "backlog" : defaultPolicy;
  const [policy, setPolicy] = useState<IncompletePolicy>(initial);

  const preview = useQuery({
    queryKey: ["agile", "complete-preview", cycle.id, policy],
    queryFn: () =>
      completeCycle(cycle.id, { incompletePolicy: policy, dryRun: true }),
  });

  const complete = useMutation({
    mutationFn: () => completeCycle(cycle.id, { incompletePolicy: policy }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["agile"] });
      await cache.invalidateQueries({ queryKey: ["work-items"] });
      toast.success(t("complete.done", { name: cycle.name }));
      onClose();
    },
  });

  const summary = preview.data
    ? policy === "leave"
      ? t("complete.summary.leave", { count: preview.data.leftCount })
      : policy === "backlog"
        ? t("complete.summary.backlog", { count: preview.data.movedCount })
        : t("complete.summary.nextCycle", {
            count: preview.data.movedCount,
            name: preview.data.destinationCycle?.name ?? "",
          })
    : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("complete.title", { name: cycle.name })}</DialogTitle>
          <DialogDescription>
            {t("complete.description", { count: incompleteCount })}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={policy}
          onValueChange={(value) => setPolicy(value as IncompletePolicy)}
          aria-label={t("complete.policyLabel")}
        >
          {INCOMPLETE_POLICIES.map((option) => {
            const disabled = option === "next_cycle" && !nextCycle;
            const id = `complete-policy-${option}`;
            return (
              <div key={option} className="flex items-start gap-2">
                <RadioGroupItem
                  id={id}
                  value={option}
                  disabled={disabled}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={id}
                  className="flex flex-col gap-0.5 font-normal"
                >
                  <span className="font-medium">
                    {t(`complete.policy.${option}.label`)}
                    {option === defaultPolicy ? (
                      <span className="ms-2 text-muted-foreground text-xs">
                        {t("complete.default")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {disabled
                      ? t("complete.noNextCycle")
                      : option === "next_cycle" && nextCycle
                        ? t("complete.policy.next_cycle.withName", {
                            name: nextCycle.name,
                          })
                        : t(`complete.policy.${option}.description`)}
                  </span>
                </Label>
              </div>
            );
          })}
        </RadioGroup>
        {summary ? (
          <Alert variant="info" data-testid="complete-summary">
            <AlertDescription>{summary}</AlertDescription>
          </Alert>
        ) : null}
        {preview.isError || complete.isError ? (
          <Alert variant="error">
            <AlertDescription>{t("complete.failed")}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={complete.isPending || preview.isLoading}
            onClick={() => complete.mutate()}
          >
            {t("complete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

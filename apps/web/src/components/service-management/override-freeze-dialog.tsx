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
  DialogTitle,
  Label,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import { type ChangeView, overrideFreeze } from "@/fetchers/service-management";
import { useInvalidateServiceManagement } from "@/hooks/queries/service-management";
import { useStepUpAction } from "@/hooks/use-step-up-action";

export const OVERRIDE_REASON_MIN = 12;

/**
 * `CH-4`: overriding a change freeze needs a reason, change authority and a fresh verification
 * (a one-use proof bound to this change and the reason). The server audits it prominently.
 */
export function OverrideFreezeDialog({
  workspaceId,
  change,
  onClose,
}: {
  workspaceId: string;
  change: ChangeView;
  onClose: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const stepUp = useStepUpAction();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const valid =
    trimmed.length >= OVERRIDE_REASON_MIN && stepUp.secret.length > 0;
  const mutation = useMutation({
    mutationFn: async () => {
      const outcome = await stepUp.run(
        {
          operation: "change_freeze_override",
          workspaceId,
          workItemKey: change.workItemKey,
          reason: trimmed,
        },
        (token) => overrideFreeze(change.workItemKey, trimmed, token),
      );
      if (!outcome.ok)
        throw new Error(t("override.stepUpFailed"), { cause: "step_up" });
      return outcome.value;
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  const pending = mutation.isPending || stepUp.busy;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("override.title")}</DialogTitle>
          <DialogDescription>
            {t("override.description", { key: change.workItemKey })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) mutation.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <Alert variant="warning">
              <AlertDescription>
                {t("override.frozenBy", {
                  names: change.freeze.freezes
                    .map((freeze) => freeze.name)
                    .join(", "),
                })}
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="override-reason">{t("override.reason")}</Label>
              <Textarea
                id="override-reason"
                autoFocus
                rows={3}
                maxLength={500}
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("override.reasonHelp", { min: OVERRIDE_REASON_MIN })}
              </p>
            </div>
            <StepUpFields action={stepUp} idPrefix="override-freeze" />
            <FailureAlert
              failure={stepUp.failure}
              title={t("override.stepUpFailed")}
            />
            {mutation.error && mutation.error.cause !== "step_up" ? (
              <Alert variant="error">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || !valid}
            >
              {t("override.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

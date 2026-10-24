import { useQueryClient } from "@tanstack/react-query";
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
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { startSecretsRotation } from "@/fetchers/god-mode/instance-health";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { FailureAlert, StepUpFields } from "./step-up-fields";

/**
 * GM-13: "Rotate secrets" re-encrypts every stored secret under the current encryption key. It
 * starts the background job and returns at once; progress is the Encryption key rotation row of
 * the health list this dialog sits beside.
 */
export function RotateSecretsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("godModeHealth");
  const queryClient = useQueryClient();
  const stepUp = useStepUpAction();
  const [started, setStarted] = useState(false);

  const submit = async () => {
    const result = await stepUp.run({ operation: "secrets_rotate" }, (token) =>
      startSecretsRotation(token),
    );
    if (!result.ok) return;
    setStarted(true);
    await queryClient.invalidateQueries({ queryKey: ["instance", "health"] });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !stepUp.busy) onClose();
      }}
    >
      <DialogContent closeLabel={t("rotateSecrets.close")}>
        <DialogHeader>
          <DialogTitle>{t("rotateSecrets.title")}</DialogTitle>
          <DialogDescription>
            {t("rotateSecrets.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          {started ? (
            <Alert variant="success">
              <AlertDescription>{t("rotateSecrets.started")}</AlertDescription>
            </Alert>
          ) : (
            <>
              <StepUpFields action={stepUp} idPrefix="rotate-secrets" />
              <FailureAlert
                failure={stepUp.failure}
                title={t("rotateSecrets.failed")}
              />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={stepUp.busy} onClick={onClose}>
            {started ? t("rotateSecrets.close") : t("rotateSecrets.cancel")}
          </Button>
          {started ? null : (
            <Button
              disabled={stepUp.busy || stepUp.secret.length === 0}
              onClick={() => void submit()}
            >
              {t("rotateSecrets.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

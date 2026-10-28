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
} from "@taskdesk/ui";
import { Copy, Dices } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import type { StepUpAction } from "@/hooks/use-step-up-action";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { generateWebhookSecret } from "./webhook-model";

/**
 * `WH-13`: rotation keeps the previous secret signing for 24 hours. The new secret is chosen
 * here (the API never returns a secret), so the dialog offers a generator and a copy button
 * before it is submitted: once saved, it cannot be read back.
 */
export function RotateSecretDialog({
  webhookName,
  pending,
  error,
  stepUp,
  onRotate,
  onClose,
}: {
  webhookName: string;
  pending: boolean;
  error: unknown;
  /** WH-15: rotation spends a fresh, operation-bound verification. */
  stepUp: StepUpAction;
  onRotate: (secret: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("webhooks");
  const [secret, setSecret] = useState(() => generateWebhookSecret());
  const valid = secret.length >= 24 && stepUp.canRun;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("rotate.title", { name: webhookName })}</DialogTitle>
          <DialogDescription>{t("rotate.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) onRotate(secret);
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="rotate-secret">{t("rotate.newSecret")}</Label>
              <div className="flex gap-2">
                <Input
                  id="rotate-secret"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  disabled={pending}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("secret.generate")}
                  disabled={pending}
                  onClick={() => setSecret(generateWebhookSecret())}
                >
                  <Dices aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("secret.copy")}
                  onClick={() => void copyToClipboard(secret)}
                >
                  <Copy aria-hidden="true" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("rotate.copyWarning")}
              </p>
            </div>
            <StepUpFields action={stepUp} idPrefix="rotate-webhook" />
            <FailureAlert
              failure={stepUp.failure}
              title={t("stepUp.failedTitle")}
            />
            {error ? (
              <Alert variant="error">
                <AlertDescription>
                  {error instanceof Error && error.message
                    ? error.message
                    : t("rotate.failed")}
                </AlertDescription>
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
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {t("rotate.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { useIdentityConnectionMutations } from "@/hooks/mutations/god-mode/use-identity-connection-mutations";
import type { StepUpAction } from "@/hooks/use-step-up-action";

type Mutations = ReturnType<typeof useIdentityConnectionMutations>;

/**
 * Bearer token lifecycle. The settings read does not say whether a token exists, so both
 * operations are always offered and the API's own answer (a revoke with no token is a rejected
 * no-op that spends no proof) is reported. A rotated bearer is shown exactly once, held only in
 * this component's state, and discarded on dismissal, on any other SCIM change and on unmount.
 */
export function ScimTokenSettings({
  connectionId,
  version,
  step,
  mutations,
  issuedBearer,
  onIssued,
  onDone,
}: {
  connectionId: string;
  version: number;
  step: StepUpAction;
  mutations: Mutations;
  issuedBearer: string | null;
  onIssued: (bearer: string | null) => void;
  onDone: (notice: "rotated" | "revoked") => void;
}) {
  const { t } = useTranslation("identityConnections");
  const [copied, setCopied] = useState(false);
  const [clipboardFailed, setClipboardFailed] = useState(false);

  useEffect(() => () => onIssued(null), [onIssued]);

  async function rotate() {
    onIssued(null);
    setCopied(false);
    setClipboardFailed(false);
    const result = await step.run(
      { operation: "scim_token_rotate", connectionId, version },
      (token) =>
        mutations.rotateToken.mutateAsync({
          id: connectionId,
          version,
          token,
          onBearer: (bearer) => onIssued(bearer),
        }),
    );
    if (result.ok) onDone("rotated");
  }

  async function revoke() {
    onIssued(null);
    const result = await step.run(
      { operation: "scim_token_revoke", connectionId, version },
      (token) =>
        mutations.revokeToken.mutateAsync({ id: connectionId, version, token }),
    );
    if (result.ok) onDone("revoked");
  }

  async function copy() {
    if (!issuedBearer) return;
    try {
      await navigator.clipboard.writeText(issuedBearer);
      setCopied(true);
      setClipboardFailed(false);
    } catch {
      setClipboardFailed(true);
    }
  }

  return (
    <section aria-labelledby="scim-token-heading" className="space-y-3">
      <header className="space-y-1">
        <h3 className="font-semibold" id="scim-token-heading">
          {t("scim.token.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("scim.token.description")}
        </p>
      </header>
      {issuedBearer ? (
        <Alert variant="warning">
          <AlertTitle>{t("scim.token.issuedTitle")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t("scim.token.issuedWarning")}</p>
            <Label htmlFor="scim-issued-bearer">
              {t("scim.token.issuedLabel")}
            </Label>
            <div className="flex gap-2">
              <Input
                autoComplete="off"
                id="scim-issued-bearer"
                readOnly
                spellCheck={false}
                value={issuedBearer}
              />
              <Button
                onClick={() => void copy()}
                type="button"
                variant="outline"
              >
                {copied ? t("scim.token.copied") : t("scim.token.copy")}
              </Button>
            </div>
            {clipboardFailed ? (
              <p className="text-sm">{t("scim.token.clipboardFailed")}</p>
            ) : null}
            <Button
              onClick={() => onIssued(null)}
              type="button"
              variant="secondary"
            >
              {t("scim.token.dismiss")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={step.busy}
          onClick={() => void rotate()}
          type="button"
        >
          {t("scim.token.rotate")}
        </Button>
        <Button
          disabled={step.busy}
          onClick={() => void revoke()}
          type="button"
          variant="destructive"
        >
          {t("scim.token.revoke")}
        </Button>
      </div>
    </section>
  );
}

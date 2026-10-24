import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type Capability, capabilityTier } from "@taskdesk/permissions";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import {
  EXPIRATION_SECONDS,
  READ_CAPABILITIES,
  WRITE_CAPABILITY_GROUPS,
} from "@/components/settings/create-api-key-dialog";
import { describeCapability } from "@/components/settings/roles/capability-model";
import { createServiceKey } from "@/fetchers/service-keys";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import type { CreateApiKeyResponse } from "@/types/api-key";

export const serviceKeysKey = (workspaceId: string) =>
  ["service-keys", workspaceId] as const;

const EXPIRY_CHOICES = ["30d", "90d", "never"] as const;

/**
 * AK-1 / AK-7: a workspace service key. Creating one is elevated, so the create spends a fresh,
 * single-use verification bound to exactly this name, expiry, subset and allowlist. The subset
 * is frozen at creation and bounded by the creator's own authority; the API refuses anything
 * beyond it, so the switches below are a request, never a grant.
 */
export function CreateServiceKeyDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (key: CreateApiKeyResponse) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const stepUp = useStepUpAction();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_CHOICES)[number]>("90d");
  const [ipAllowlist, setIpAllowlist] = useState("");
  const [writes, setWrites] = useState<ReadonlySet<Capability>>(new Set());

  const nameValid = name.trim().length >= 3;
  const toggle = (capability: Capability) =>
    setWrites((previous) => {
      const next = new Set(previous);
      if (next.has(capability)) next.delete(capability);
      else next.add(capability);
      return next;
    });

  const mutation = useMutation({
    mutationFn: async () => {
      const addresses = ipAllowlist
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const input = {
        name: name.trim(),
        expiresIn: expiry === "never" ? null : EXPIRATION_SECONDS[expiry],
        capabilities: [...READ_CAPABILITIES, ...writes],
        ...(addresses.length > 0 ? { ipAllowlist: addresses } : {}),
      };
      const outcome = await stepUp.run(
        { operation: "service_key_create", workspaceId, ...input },
        (token) => createServiceKey(workspaceId, input, token),
        { writeErrors: "rethrow" },
      );
      if (!outcome.ok)
        throw new Error(t("settings:serviceKeys.stepUpFailed"), {
          cause: "step_up",
        });
      return outcome.value;
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: serviceKeysKey(workspaceId),
      });
      onCreated(created);
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg p-0 gap-0"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader className="px-6 py-5 border-b border-border">
          <DialogTitle>{t("settings:serviceKeys.create.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:serviceKeys.create.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (nameValid && stepUp.secret && !mutation.isPending)
              mutation.mutate();
          }}
        >
          <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="service-key-name">
                {t("settings:serviceKeys.create.nameLabel")}
              </Label>
              <Input
                id="service-key-name"
                value={name}
                disabled={mutation.isPending}
                placeholder={t("settings:serviceKeys.create.namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-key-expiry">
                {t("settings:serviceKeys.create.expiryLabel")}
              </Label>
              <Select
                items={EXPIRY_CHOICES.map((value) => ({
                  value,
                  label: t(`settings:serviceKeys.create.expiry.${value}`),
                }))}
                value={expiry}
                disabled={mutation.isPending}
                onValueChange={(value) => {
                  if (
                    value !== null &&
                    (EXPIRY_CHOICES as readonly string[]).includes(value)
                  )
                    setExpiry(value as (typeof EXPIRY_CHOICES)[number]);
                }}
              >
                <SelectTrigger id="service-key-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_CHOICES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`settings:serviceKeys.create.expiry.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-key-ips">
                {t("settings:apiKey.createDialog.ipAllowlistLabel")}
              </Label>
              <Input
                id="service-key-ips"
                value={ipAllowlist}
                disabled={mutation.isPending}
                placeholder={t(
                  "settings:apiKey.createDialog.ipAllowlistPlaceholder",
                )}
                onChange={(event) => setIpAllowlist(event.target.value)}
              />
            </div>
            <Separator />
            <Alert variant="warning">
              <AlertTitle>
                {t("settings:serviceKeys.create.frozenTitle")}
              </AlertTitle>
              <AlertDescription>
                {t("settings:serviceKeys.create.frozenDescription")}
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              {t("settings:serviceKeys.create.readIncluded")}
            </p>
            <ScrollArea className="h-56 rounded-md border border-border">
              <div className="space-y-4 p-4">
                {WRITE_CAPABILITY_GROUPS.map(
                  ({ group, capabilities }, groupIndex) => (
                    <div key={group} className="space-y-4">
                      {groupIndex > 0 && <Separator />}
                      <p className="text-sm font-medium">
                        {t(
                          `settings:apiKey.createDialog.capabilityGroups.${group}`,
                          { defaultValue: group },
                        )}
                      </p>
                      {capabilities
                        .filter(
                          (capability) =>
                            capabilityTier(capability) === "workspace",
                        )
                        .map((capability) => (
                          <div
                            key={capability}
                            className="flex items-center justify-between gap-6"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <Label className="text-sm font-medium">
                                {describeCapability(capability)}
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                {capability}
                              </p>
                            </div>
                            <Switch
                              checked={writes.has(capability)}
                              disabled={mutation.isPending}
                              onCheckedChange={() => toggle(capability)}
                            />
                          </div>
                        ))}
                    </div>
                  ),
                )}
              </div>
            </ScrollArea>
            <StepUpFields action={stepUp} idPrefix="create-service-key" />
            <FailureAlert
              failure={stepUp.failure}
              title={t("settings:serviceKeys.stepUpFailed")}
            />
            {mutation.error && mutation.error.cause !== "step_up" ? (
              <Alert variant="error">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !nameValid || !stepUp.secret}
            >
              {mutation.isPending
                ? t("settings:serviceKeys.create.creating")
                : t("settings:serviceKeys.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

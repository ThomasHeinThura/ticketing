import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  type Capability,
  capabilitiesInGroup,
  capabilityTier,
} from "@taskdesk/permissions";
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
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
import { useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { describeCapability } from "@/components/settings/roles/capability-model";
import useCreateApiKey from "@/hooks/mutations/api-key/use-create-api-key";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";
import type { CreateApiKeyResponse } from "@/types/api-key";

export const EXPIRATION_SECONDS = {
  "1d": 86400,
  "7d": 604800,
  "30d": 2592000,
  "90d": 7776000,
} as const;

type FormValues = {
  name: string;
  expiresIn: string;
  allowWrites: boolean;
  isMcp: boolean;
  ipAllowlist: string;
};

/**
 * The write opt-in (AK-9): every workspace-tier capability that is not a plain read. The
 * read set is always included and is not offered as a choice, so a new key is read-only
 * until something here is ticked.
 */
export const READ_CAPABILITIES = (
  Object.keys(CAPABILITIES) as Capability[]
).filter(
  (capability) =>
    capabilityTier(capability) === "workspace" && capability.endsWith(":read"),
);

export const WRITE_CAPABILITY_GROUPS = CAPABILITY_GROUPS.map((group) => ({
  group,
  capabilities: capabilitiesInGroup(group).filter(
    (capability) =>
      capabilityTier(capability) === "workspace" &&
      !capability.endsWith(":read"),
  ),
})).filter(({ capabilities }) => capabilities.length > 0);

/** Instance write capabilities are offered only for explicitly opted-in admin personal keys. */
export const INSTANCE_WRITE_CAPABILITIES = capabilitiesInGroup(
  "Instance",
).filter((capability) => {
  const action = capability.split(":")[1] ?? "";
  return !action.startsWith("read") && !action.endsWith("_read");
});

type CreateApiKeyDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (data: CreateApiKeyResponse) => void;
};

export function CreateApiKeyDialog({
  open,
  onClose,
  onSuccess,
}: CreateApiKeyDialogProps) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const isInstanceAdmin = session?.user?.role === "admin";
  const { mutateAsync: createApiKey, reset: resetCreatedKey } =
    useCreateApiKey();
  const capabilitySwitchId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [writeCapabilities, setWriteCapabilities] = useState<
    ReadonlySet<Capability>
  >(new Set());

  const createApiKeySchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t("settings:apiKey.createDialog.validation.nameRequired"))
          .min(3, t("settings:apiKey.createDialog.validation.nameShort")),
        expiresIn: z
          .string()
          .min(
            1,
            t("settings:apiKey.createDialog.validation.expirationRequired"),
          ),
        allowWrites: z.boolean(),
        isMcp: z.boolean(),
        ipAllowlist: z.string(),
      }),
    [t],
  );

  const expirationOptions = useMemo(
    () =>
      [
        {
          label: t("settings:apiKey.createDialog.expiration1d"),
          value: "1d",
        },
        {
          label: t("settings:apiKey.createDialog.expiration7d"),
          value: "7d",
        },
        {
          label: t("settings:apiKey.createDialog.expiration30d"),
          value: "30d",
        },
        {
          label: t("settings:apiKey.createDialog.expiration90d"),
          value: "90d",
        },
        {
          label: t("settings:apiKey.createDialog.expirationNever"),
          value: "never",
        },
      ] as const,
    [t],
  );

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(createApiKeySchema),
    defaultValues: {
      name: "",
      expiresIn: "30d",
      allowWrites: false,
      isMcp: false,
      ipAllowlist: "",
    },
  });
  const allowWrites = form.watch("allowWrites");

  const toggleWriteCapability = (capability: Capability) => {
    setWriteCapabilities((previous) => {
      const next = new Set(previous);
      if (next.has(capability)) next.delete(capability);
      else next.add(capability);
      return next;
    });
  };

  const onSubmit = async (data: FormValues) => {
    const expiresInValue =
      data.expiresIn === "never"
        ? null
        : EXPIRATION_SECONDS[data.expiresIn as keyof typeof EXPIRATION_SECONDS];

    setIsSubmitting(true);
    try {
      const ipAllowlist = data.ipAllowlist
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const result = await createApiKey({
        name: data.name,
        expiresIn: expiresInValue ?? null,
        isMcp: data.isMcp,
        ...(ipAllowlist.length > 0 ? { ipAllowlist } : {}),
        // Omitted means the read-only default; ticked writes are added to it by the server's
        // own read set, never trusted from here (the API re-validates every name).
        ...(data.allowWrites && writeCapabilities.size > 0
          ? {
              capabilities: [
                ...READ_CAPABILITIES,
                ...[...writeCapabilities].filter(
                  (capability) =>
                    capabilityTier(capability) === "workspace" ||
                    isInstanceAdmin,
                ),
              ],
            }
          : {}),
      });

      form.reset();
      setWriteCapabilities(new Set());
      onSuccess(result);
      // The plaintext key now lives only in the parent's dialog state; drop the copy React Query
      // keeps in its mutation cache.
      resetCreatedKey();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:apiKey.createDialog.failedCreate"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      form.reset();
      setWriteCapabilities(new Set());
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-lg p-0 gap-0"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader className="px-6 py-5 border-b border-border">
          <DialogTitle>{t("settings:apiKey.createDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:apiKey.createDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-0">
            <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings:apiKey.createDialog.nameLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "settings:apiKey.createDialog.namePlaceholder",
                        )}
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("settings:apiKey.createDialog.nameDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiresIn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings:apiKey.createDialog.expirationLabel")}
                    </FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t(
                              "settings:apiKey.createDialog.expirationPlaceholder",
                            )}
                          >
                            {expirationOptions.find(
                              (o) => o.value === field.value,
                            )?.label ?? field.value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {expirationOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t("settings:apiKey.createDialog.expirationDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ipAllowlist"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings:apiKey.createDialog.ipAllowlistLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "settings:apiKey.createDialog.ipAllowlistPlaceholder",
                        )}
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("settings:apiKey.createDialog.ipAllowlistDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <FormField
                control={form.control}
                name="isMcp"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-6">
                    <div className="space-y-0.5 min-w-0">
                      <FormLabel>
                        {t("settings:apiKey.createDialog.agentLabel")}
                      </FormLabel>
                      <FormDescription>
                        {t("settings:apiKey.createDialog.agentDescription")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="allowWrites"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-6">
                    <div className="space-y-0.5 min-w-0">
                      <FormLabel>
                        {t("settings:apiKey.createDialog.writesLabel")}
                      </FormLabel>
                      <FormDescription>
                        {t("settings:apiKey.createDialog.writesDescription")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {allowWrites && (
                <>
                  <Alert variant="warning">
                    <AlertTitle>
                      {t("settings:apiKey.createDialog.writesWarningTitle")}
                    </AlertTitle>
                    <AlertDescription>
                      {t("settings:apiKey.createDialog.writesWarning")}
                    </AlertDescription>
                  </Alert>
                  <ScrollArea className="h-64 rounded-md border border-border">
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
                            {capabilities.map((capability) => (
                              <div
                                key={capability}
                                className="flex items-center justify-between gap-6"
                              >
                                <div className="space-y-0.5 flex-1 min-w-0">
                                  <Label
                                    htmlFor={`${capabilitySwitchId}-${capability}`}
                                    className="text-sm font-medium"
                                  >
                                    {describeCapability(capability)}
                                  </Label>
                                  <p className="text-xs text-muted-foreground">
                                    {capability}
                                  </p>
                                </div>
                                <Switch
                                  id={`${capabilitySwitchId}-${capability}`}
                                  checked={writeCapabilities.has(capability)}
                                  onCheckedChange={() =>
                                    toggleWriteCapability(capability)
                                  }
                                  disabled={isSubmitting}
                                />
                              </div>
                            ))}
                          </div>
                        ),
                      )}
                      {isInstanceAdmin &&
                        INSTANCE_WRITE_CAPABILITIES.length > 0 && (
                          <>
                            <Separator />
                            <div className="space-y-4">
                              <p className="text-sm font-medium">
                                {t(
                                  "settings:apiKey.createDialog.capabilityGroups.Instance",
                                  { defaultValue: "Instance" },
                                )}
                              </p>
                              {INSTANCE_WRITE_CAPABILITIES.map((capability) => (
                                <div
                                  key={capability}
                                  className="flex items-center justify-between gap-6"
                                >
                                  <div className="space-y-0.5 flex-1 min-w-0">
                                    <Label
                                      htmlFor={`${capabilitySwitchId}-${capability}`}
                                      className="text-sm font-medium"
                                    >
                                      {describeCapability(capability)}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                      {capability}
                                    </p>
                                  </div>
                                  <Switch
                                    id={`${capabilitySwitchId}-${capability}`}
                                    checked={writeCapabilities.has(capability)}
                                    onCheckedChange={() =>
                                      toggleWriteCapability(capability)
                                    }
                                    disabled={isSubmitting}
                                  />
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("settings:apiKey.createDialog.creating")
                  : t("settings:apiKey.createDialog.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

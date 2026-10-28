import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import {
  ArrowLeft,
  Copy,
  Dices,
  History,
  KeyRound,
  RefreshCw,
  Send,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import PageTitle from "@/components/page-title";
import {
  createWebhook,
  listWebhooks,
  requestWebhookDeletion,
  rotateWebhookSecret,
  sendWebhookTestEvent,
  updateWebhook,
  type Webhook,
  type WebhookDelivery,
} from "@/fetchers/webhook/webhooks";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { RotateSecretDialog } from "./rotate-secret-dialog";
import {
  generateWebhookSecret,
  healthVariant,
  needsReown,
  validateWebhookForm,
  WEBHOOK_EVENT_GROUPS,
} from "./webhook-model";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type FormState = {
  name: string;
  url: string;
  secret: string;
  events: string[];
};

function EventPicker({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation("webhooks");
  return (
    <div className="space-y-4">
      {WEBHOOK_EVENT_GROUPS.map((entry) => (
        <div key={entry.group} className="space-y-2">
          <p className="text-sm font-medium">
            {t(`events.groups.${entry.group}`)}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {entry.events.map((event) => (
              <div key={event} className="flex items-center gap-2">
                <Checkbox
                  id={`webhook-event-${event}`}
                  checked={value.includes(event)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...value, event]
                        : value.filter((entry) => entry !== event),
                    )
                  }
                />
                <Label
                  htmlFor={`webhook-event-${event}`}
                  className="font-normal"
                >
                  <span className="font-mono text-xs">{event}</span>
                </Label>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TestResult({ delivery }: { delivery: WebhookDelivery }) {
  const { t } = useTranslation("webhooks");
  const ok = delivery.state === "delivered";
  return (
    <Alert variant={ok ? "success" : "error"}>
      <AlertTitle>{ok ? t("test.succeeded") : t("test.failed")}</AlertTitle>
      <AlertDescription>
        {t("test.detail", {
          status: delivery.statusCode ?? t("test.noResponse"),
          duration: delivery.durationMs ?? 0,
        })}
        {delivery.error ? ` ${delivery.error}` : ""}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The webhook editor (`/agent/settings/webhooks/{id}`; `new` creates). Creating a webhook and
 * rotating its secret are session-only elevated actions (`WH-15`); the API refuses them from a
 * key. The secret is write-only: the form generates one for the owner to copy before saving.
 */
export function WebhookEditor({ id }: { id: string }) {
  const { t } = useTranslation("webhooks");
  const isNew = id === "new";
  const navigate = useNavigate();
  const cache = useQueryClient();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { canManageWebhooks, isCheckingPermissions } = useWorkspacePermission();
  const canManage = canManageWebhooks();
  const workspaceId = workspace?.id ?? "";
  const webhooks = useQuery({
    queryKey: ["webhooks", workspaceId],
    enabled: Boolean(workspaceId && canManage),
    queryFn: () => listWebhooks(workspaceId),
  });
  const webhook = webhooks.data?.find((entry) => entry.id === id);
  const [rotating, setRotating] = useState(false);
  const [testResult, setTestResult] = useState<WebhookDelivery | null>(null);

  const refresh = () =>
    cache.invalidateQueries({ queryKey: ["webhooks", workspaceId] });

  const loading =
    workspaceLoading ||
    isCheckingPermissions ||
    (canManage && !isNew && webhooks.isLoading);

  const pageTitle = t(isNew ? "editor.newTitle" : "editor.pageTitle");

  if (loading) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title={pageTitle} />
        <div role="status" aria-label={t("editor.loading")}>
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="mt-4 h-72 w-full" />
        </div>
      </div>
    );
  }
  if (!canManage) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title={pageTitle} />
        <Alert variant="info">
          <AlertTitle>{t("list.readOnlyTitle")}</AlertTitle>
          <AlertDescription>{t("list.readOnlyDescription")}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!isNew && (webhooks.isError || !webhook)) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title={pageTitle} />
        <Alert variant="error">
          <AlertTitle>{t("editor.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {webhooks.isError
              ? t("editor.loadErrorDescription")
              : t("editor.notFound")}
            <Button
              className="w-fit"
              variant="outline"
              onClick={() => void webhooks.refetch()}
            >
              <RefreshCw aria-hidden="true" />
              {t("list.retry")}
            </Button>
            <Button
              className="w-fit"
              variant="outline"
              render={<Link to={routes.webhooks.path} />}
            >
              {t("editor.back")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
      <PageTitle title={pageTitle} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ms-2 w-fit"
            render={<Link to={routes.webhooks.path} />}
          >
            <ArrowLeft aria-hidden="true" />
            {t("editor.back")}
          </Button>
          <h1 className="text-2xl font-semibold">
            {isNew ? t("editor.newTitle") : webhook?.name}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("editor.description")}
          </p>
        </div>
        {webhook ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={healthVariant(webhook.health)}>
              {t(`health.${webhook.health}`)}
            </Badge>
            <Button
              variant="outline"
              render={
                <Link
                  to={routes.webhookDeliveries.path}
                  params={{ id: webhook.id }}
                />
              }
            >
              <History aria-hidden="true" />
              {t("editor.deliveries")}
            </Button>
          </div>
        ) : null}
      </div>

      <WebhookForm
        key={webhook ? webhook.id : "new"}
        webhook={webhook}
        workspaceId={workspaceId}
        onSaved={async (saved) => {
          await refresh();
          if (isNew) {
            toast.success(t("editor.created"));
            void navigate({
              to: routes.webhookEditor.path,
              params: { id: saved.id },
            });
          } else {
            toast.success(t("editor.saved"));
          }
        }}
      />

      {webhook ? (
        <>
          <StatusCard webhook={webhook} onChanged={refresh} />
          <Card>
            <CardHeader>
              <CardTitle>{t("secret.title")}</CardTitle>
              <CardDescription>{t("secret.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {webhook.secretRotatedAt
                  ? t("secret.rotatedAt", {
                      when: formatDateTime(webhook.secretRotatedAt),
                    })
                  : t("secret.neverRotated")}
                {webhook.previousSecretActive
                  ? ` ${t("secret.overlapActive")}`
                  : ""}
              </p>
              <Button variant="outline" onClick={() => setRotating(true)}>
                <KeyRound aria-hidden="true" />
                {t("secret.rotate")}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("test.title")}</CardTitle>
              <CardDescription>{t("test.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SendTest
                webhook={webhook}
                onResult={(delivery) => {
                  setTestResult(delivery);
                  void refresh();
                }}
              />
              {testResult ? <TestResult delivery={testResult} /> : null}
            </CardContent>
          </Card>
          <DeleteCard webhook={webhook} />
          {rotating ? (
            <RotateDialog
              webhook={webhook}
              onClose={() => setRotating(false)}
              onRotated={async () => {
                setRotating(false);
                toast.success(t("rotate.rotated"));
                await refresh();
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RotateDialog({
  webhook,
  onClose,
  onRotated,
}: {
  webhook: Webhook;
  onClose: () => void;
  onRotated: () => Promise<void>;
}) {
  const stepUp = useStepUpAction();
  return (
    <RotateSecretDialog
      webhookName={webhook.name}
      pending={stepUp.busy}
      error={null}
      stepUp={stepUp}
      onRotate={(secret) => {
        void stepUp
          .run(
            {
              operation: "webhook_rotate_secret",
              workspaceId: webhook.workspaceId,
              webhookId: webhook.id,
            },
            (token) => rotateWebhookSecret(webhook.id, secret, token),
          )
          .then((result) => (result.ok ? onRotated() : undefined));
      }}
      onClose={onClose}
    />
  );
}

/**
 * ST-8 / AK-11: deletion is a Danger-zone action that only opens a typed-name + step-up pending
 * action; the webhook and its delivery history stay until the requester approves it.
 */
function DeleteCard({ webhook }: { webhook: Webhook }) {
  const { t } = useTranslation("webhooks");
  const navigate = useNavigate();
  const request = useMutation({
    mutationFn: () => requestWebhookDeletion(webhook.id),
    onSuccess: () => {
      toast.success(t("delete.requested"));
      void navigate({ to: routes.pendingActions.path as never });
    },
  });
  return (
    <Card className="border-destructive/32">
      <CardHeader>
        <CardTitle>{t("delete.title")}</CardTitle>
        <CardDescription>{t("delete.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          variant="destructive"
          disabled={request.isPending}
          onClick={() => request.mutate()}
        >
          {t("delete.action")}
        </Button>
        {request.error ? (
          <Alert variant="error">
            <AlertDescription>
              {errorText(request.error, t("delete.failed"))}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SendTest({
  webhook,
  onResult,
}: {
  webhook: Webhook;
  onResult: (delivery: WebhookDelivery) => void;
}) {
  const { t } = useTranslation("webhooks");
  const send = useMutation({
    mutationFn: () => sendWebhookTestEvent(webhook.id),
    onSuccess: onResult,
    onError: (error) => toast.error(errorText(error, t("test.failedToSend"))),
  });
  return (
    <Button
      variant="outline"
      disabled={send.isPending || !webhook.active}
      onClick={() => send.mutate()}
    >
      <Send aria-hidden="true" />
      {t("test.send")}
    </Button>
  );
}

function StatusCard({
  webhook,
  onChanged,
}: {
  webhook: Webhook;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation("webhooks");
  const stepUp = useStepUpAction();
  const update = useMutation({
    mutationFn: async (input: { active?: boolean; reown?: true }) => {
      if (!input.reown)
        return updateWebhook(webhook.id, {
          ...input,
          version: webhook.version,
        });
      // P4R1-L1: taking over a webhook is elevated, like changing its destination; the proof
      // binds the unchanged destination.
      const outcome = await stepUp.run(
        {
          operation: "webhook_update_url",
          workspaceId: webhook.workspaceId,
          webhookId: webhook.id,
          url: webhook.url,
        },
        (token) =>
          updateWebhook(
            webhook.id,
            { ...input, version: webhook.version },
            token,
          ),
      );
      if (!outcome.ok)
        throw new Error(t("stepUp.failedTitle"), { cause: "step_up" });
      return outcome.value;
    },
    onSuccess: async () => {
      await onChanged();
    },
    onError: (error) =>
      error.cause === "step_up"
        ? undefined
        : toast.error(errorText(error, t("editor.saveFailed"))),
  });
  const reown = needsReown(webhook);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("status.title")}</CardTitle>
        <CardDescription>
          {t("status.owner", {
            name: webhook.ownerName ?? t("status.unknownOwner"),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="webhook-active"
            checked={webhook.active}
            disabled={update.isPending || reown}
            onCheckedChange={(checked) => update.mutate({ active: checked })}
          />
          <Label htmlFor="webhook-active">{t("status.active")}</Label>
        </div>
        {webhook.disabledAt ? (
          <Alert variant="warning">
            <AlertTitle>
              {t(`status.reasons.${webhook.disabledReason ?? "manual"}`, {
                defaultValue: t("status.reasons.manual"),
              })}
            </AlertTitle>
            <AlertDescription>
              {t("status.pausedAt", {
                when: formatDateTime(webhook.disabledAt),
              })}
              {webhook.lastError ? ` ${webhook.lastError}` : ""}
            </AlertDescription>
          </Alert>
        ) : webhook.failingSince ? (
          <Alert variant="error">
            <AlertTitle>{t("status.failingTitle")}</AlertTitle>
            <AlertDescription>
              {t("status.failingSince", {
                when: formatDateTime(webhook.failingSince),
              })}
              {webhook.lastError ? ` ${webhook.lastError}` : ""}
            </AlertDescription>
          </Alert>
        ) : null}
        {reown ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("status.reownHelp")}
            </p>
            <StepUpFields action={stepUp} idPrefix="webhook-reown" />
            <FailureAlert
              failure={stepUp.failure}
              title={t("stepUp.failedTitle")}
            />
            <Button
              variant="outline"
              disabled={update.isPending || !stepUp.canRun}
              onClick={() => update.mutate({ reown: true, active: true })}
            >
              {t("status.reown")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function WebhookForm({
  webhook,
  workspaceId,
  onSaved,
}: {
  webhook: Webhook | undefined;
  workspaceId: string;
  onSaved: (saved: Webhook) => Promise<void>;
}) {
  const { t } = useTranslation("webhooks");
  const isNew = !webhook;
  const [form, setForm] = useState<FormState>(() => ({
    name: webhook?.name ?? "",
    url: webhook?.url ?? "",
    secret: isNew ? generateWebhookSecret() : "",
    events: webhook?.events ?? [],
  }));
  const [touched, setTouched] = useState(false);
  const allowHttp = import.meta.env.DEV;
  const errors = validateWebhookForm(form, {
    requireSecret: isNew,
    allowHttp,
  });
  // WH-15: creating a webhook and changing its destination are elevated, so each spends a
  // fresh, operation-bound verification. A rename or event change alone needs none.
  const stepUp = useStepUpAction();
  const urlChanged = Boolean(webhook) && form.url.trim() !== webhook?.url;
  const needsStepUp = isNew || urlChanged;
  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      const url = form.url.trim();
      if (webhook && !urlChanged)
        return updateWebhook(webhook.id, {
          name,
          events: form.events,
          version: webhook.version,
        });
      const outcome = webhook
        ? await stepUp.run(
            {
              operation: "webhook_update_url",
              workspaceId: webhook.workspaceId,
              webhookId: webhook.id,
              url,
            },
            (token) =>
              updateWebhook(
                webhook.id,
                { name, url, events: form.events, version: webhook.version },
                token,
              ),
          )
        : await stepUp.run(
            {
              operation: "webhook_create",
              workspaceId,
              name,
              url,
              events: form.events,
            },
            (token) =>
              createWebhook(
                workspaceId,
                { name, url, secret: form.secret, events: form.events },
                token,
              ),
          );
      if (!outcome.ok)
        throw new Error(t("stepUp.failedTitle"), { cause: "step_up" });
      return outcome.value;
    },
    onSuccess: onSaved,
  });
  const dirty =
    isNew ||
    form.name.trim() !== webhook?.name ||
    form.url.trim() !== webhook?.url ||
    [...form.events].sort().join(",") !==
      [...(webhook?.events ?? [])].sort().join(",");
  const message = (error: (typeof errors)[number]) => t(`validation.${error}`);

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (errors.length === 0 && !save.isPending) save.mutate();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("editor.detailsTitle")}</CardTitle>
          <CardDescription>{t("editor.detailsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-name">{t("editor.name")}</Label>
            <Input
              id="webhook-name"
              maxLength={120}
              value={form.name}
              disabled={save.isPending}
              aria-invalid={touched && errors.includes("nameRequired")}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
            {touched && errors.includes("nameRequired") ? (
              <p className="text-xs text-destructive-foreground">
                {message("nameRequired")}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhook-url">{t("editor.url")}</Label>
            <Input
              id="webhook-url"
              type="url"
              inputMode="url"
              maxLength={2048}
              placeholder="https://"
              value={form.url}
              disabled={save.isPending}
              aria-invalid={
                touched &&
                (errors.includes("urlInvalid") ||
                  errors.includes("urlNotHttps"))
              }
              onChange={(event) =>
                setForm((current) => ({ ...current, url: event.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              {t("editor.urlHelp")}
            </p>
            {touched && errors.includes("urlInvalid") ? (
              <p className="text-xs text-destructive-foreground">
                {message("urlInvalid")}
              </p>
            ) : null}
            {touched && errors.includes("urlNotHttps") ? (
              <p className="text-xs text-destructive-foreground">
                {message("urlNotHttps")}
              </p>
            ) : null}
          </div>
          {isNew ? (
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">{t("secret.label")}</Label>
              <div className="flex gap-2">
                <Input
                  id="webhook-secret"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.secret}
                  disabled={save.isPending}
                  aria-invalid={touched && errors.includes("secretTooShort")}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      secret: event.target.value,
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("secret.generate")}
                  disabled={save.isPending}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      secret: generateWebhookSecret(),
                    }))
                  }
                >
                  <Dices aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("secret.copy")}
                  onClick={() => void copyToClipboard(form.secret)}
                >
                  <Copy aria-hidden="true" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("secret.createHelp")}
              </p>
              {touched && errors.includes("secretTooShort") ? (
                <p className="text-xs text-destructive-foreground">
                  {message("secretTooShort")}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("events.title")}</CardTitle>
          <CardDescription>{t("events.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <EventPicker
            value={form.events}
            disabled={save.isPending}
            onChange={(events) =>
              setForm((current) => ({ ...current, events }))
            }
          />
          {touched && errors.includes("eventsRequired") ? (
            <p className="text-xs text-destructive-foreground">
              {message("eventsRequired")}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {needsStepUp ? (
        <StepUpFields action={stepUp} idPrefix="webhook-editor" />
      ) : null}
      <FailureAlert failure={stepUp.failure} title={t("stepUp.failedTitle")} />
      {save.error && save.error.cause !== "step_up" ? (
        <Alert variant="error">
          <AlertDescription>
            {errorText(save.error, t("editor.saveFailed"))}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={save.isPending || !dirty || (needsStepUp && !stepUp.canRun)}
        >
          {isNew ? t("editor.create") : t("editor.save")}
        </Button>
      </div>
    </form>
  );
}

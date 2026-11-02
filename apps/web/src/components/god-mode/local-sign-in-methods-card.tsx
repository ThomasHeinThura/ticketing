import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { identityAdminFailureKind } from "@/fetchers/god-mode/identity-admin-error";
import {
  type LocalAuthMethodSet,
  type LocalAuthMethods,
  type LocalAuthMethodsByPortal,
  updateLocalAuthMethods,
} from "@/fetchers/god-mode/local-auth-methods";
import {
  localAuthMethodsKey,
  useLocalAuthMethods,
} from "@/hooks/queries/god-mode/use-local-auth-methods";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { FailureAlert, StepUpFields } from "./step-up-fields";

type Audience = keyof LocalAuthMethodsByPortal;
type Method = keyof LocalAuthMethodSet;

const METHODS: readonly Method[] = ["password", "magicLink", "emailOtp"];
const AUDIENCES: readonly Audience[] = ["agent", "customer"];

function sameMethods(a: LocalAuthMethodsByPortal, b: LocalAuthMethodsByPortal) {
  return AUDIENCES.every((audience) =>
    METHODS.every((method) => a[audience][method] === b[audience][method]),
  );
}

function requestOf(data: LocalAuthMethods): LocalAuthMethodsByPortal {
  // The environment keeps email-code sign-in off on both hosts; the server refuses to store it
  // as on, so it is shown and sent as off whatever an older stored row says.
  const emailOtpOff = data.emailOtpDisabledByEnvironment;
  return {
    // Staff password is the break-glass sign-in and is always sent as on (R5).
    agent: {
      ...data.agent,
      password: true,
      emailOtp: emailOtpOff ? false : data.agent.emailOtp,
    },
    customer: {
      ...data.customer,
      emailOtp: emailOtpOff ? false : data.customer.emailOtp,
    },
  };
}

/**
 * S6: the local (non-identity-provider) sign-in methods for the staff and customer portals. Staff
 * password is locked on. Saving is elevated: the proof is bound to the exact six switches.
 */
export function LocalSignInMethodsCard() {
  const { t } = useTranslation("identityConnections");
  const query = useLocalAuthMethods();
  const [draft, setDraft] = useState<LocalAuthMethodsByPortal | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (query.isPending)
    return (
      <Card>
        <CardHeader>
          <CardTitle render={(props) => <h2 {...props} />}>
            {t("signInMethods.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            aria-label={t("signInMethods.loading")}
            className="space-y-3"
            role="status"
          >
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );

  if (query.isError) {
    const denied = identityAdminFailureKind(query.error) === "denied";
    return (
      <Card>
        <CardHeader>
          <CardTitle render={(props) => <h2 {...props} />}>
            {t("signInMethods.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="error">
            <AlertTitle>{t("signInMethods.unavailable")}</AlertTitle>
            <AlertDescription>
              <p>
                {denied ? t("errors.denied") : t("signInMethods.loadFailed")}
              </p>
              {denied ? null : (
                <Button
                  onClick={() => void query.refetch()}
                  type="button"
                  variant="outline"
                >
                  {t("common.retry")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const saved = requestOf(query.data);
  const current = draft ?? saved;
  const dirty = !sameMethods(current, saved);
  const emailMethodsOn = AUDIENCES.some(
    (audience) => current[audience].magicLink || current[audience].emailOtp,
  );
  const customerNone = METHODS.every((method) => !current.customer[method]);

  const toggle = (audience: Audience, method: Method, value: boolean) =>
    setDraft({
      ...current,
      [audience]: { ...current[audience], [method]: value },
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle render={(props) => <h2 {...props} />}>
          {t("signInMethods.title")}
        </CardTitle>
        <CardDescription>{t("signInMethods.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1fr)_6rem_6rem] gap-4 border-b pb-2 text-xs font-medium text-muted-foreground sm:grid"
        >
          <span>{t("signInMethods.method")}</span>
          <span className="text-center">{t("signInMethods.staff")}</span>
          <span className="text-center">{t("signInMethods.customers")}</span>
        </div>
        <ul className="divide-y">
          {METHODS.map((method) => (
            <MethodRow
              current={current}
              emailOtpLocked={query.data.emailOtpDisabledByEnvironment}
              key={method}
              method={method}
              onToggle={toggle}
            />
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          {t("signInMethods.staffPasswordLocked")}
        </p>
        {query.data.emailOtpDisabledByEnvironment ? (
          <Alert variant="info">
            <AlertDescription>
              {t("signInMethods.emailOtpEnvironmentDisabled")}
            </AlertDescription>
          </Alert>
        ) : null}
        {query.data.emailProviderEnabled ? (
          <p className="text-sm text-muted-foreground">
            {t("signInMethods.emailProviderNotice")}
          </p>
        ) : (
          <Alert variant={emailMethodsOn ? "warning" : "info"}>
            <AlertTitle>
              {t("signInMethods.emailProviderMissingTitle")}
            </AlertTitle>
            <AlertDescription>
              <p>{t("signInMethods.emailProviderMissing")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  render={<Link to={routes.notificationProvider.path} />}
                  size="sm"
                  variant="outline"
                >
                  {t("signInMethods.emailProviderLink")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {customerNone ? (
          <p className="text-sm text-muted-foreground">
            {t("signInMethods.customersNone")}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          disabled={!dirty}
          onClick={() => setDraft(null)}
          type="button"
          variant="outline"
        >
          {t("signInMethods.reset")}
        </Button>
        <Button
          disabled={!dirty}
          onClick={() => setConfirming(true)}
          type="button"
        >
          {t("signInMethods.save")}
        </Button>
      </CardFooter>
      {confirming ? (
        <SaveDialog
          onClose={() => setConfirming(false)}
          onReload={() => {
            setConfirming(false);
            setDraft(null);
            void query.refetch();
          }}
          onSaved={() => {
            setConfirming(false);
            setDraft(null);
          }}
          request={current}
          revision={query.data.revision}
          saved={saved}
        />
      ) : null}
    </Card>
  );
}

function MethodRow({
  method,
  current,
  emailOtpLocked,
  onToggle,
}: {
  method: Method;
  current: LocalAuthMethodsByPortal;
  emailOtpLocked: boolean;
  onToggle: (audience: Audience, method: Method, value: boolean) => void;
}) {
  const { t } = useTranslation("identityConnections");
  const id = useId();
  return (
    <li className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem] sm:items-center sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-sm">{t(`signInMethods.${method}`)}</p>
        <p className="text-muted-foreground text-xs">
          {t(`signInMethods.${method}Description`)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:contents">
        {AUDIENCES.map((audience) => {
          const passwordLocked = audience === "agent" && method === "password";
          const locked =
            passwordLocked || (emailOtpLocked && method === "emailOtp");
          const switchId = `${id}-${audience}`;
          const audienceLabel = t(
            audience === "agent"
              ? "signInMethods.staff"
              : "signInMethods.customers",
          );
          return (
            <div
              className="flex items-center gap-2 sm:justify-center"
              key={audience}
            >
              <Switch
                checked={passwordLocked ? true : current[audience][method]}
                disabled={locked}
                id={switchId}
                onCheckedChange={(value) => onToggle(audience, method, value)}
              />
              <Label className="sr-only" htmlFor={switchId}>
                {t("signInMethods.switchLabel", {
                  method: t(`signInMethods.${method}`),
                  audience: audienceLabel,
                })}
              </Label>
              <span
                aria-hidden="true"
                className="text-muted-foreground text-xs sm:hidden"
              >
                {audienceLabel}
              </span>
            </div>
          );
        })}
      </div>
    </li>
  );
}

function SaveDialog({
  request,
  revision,
  saved,
  onClose,
  onReload,
  onSaved,
}: {
  request: LocalAuthMethodsByPortal;
  revision: string;
  saved: LocalAuthMethodsByPortal;
  onClose: () => void;
  onReload: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("identityConnections");
  const queryClient = useQueryClient();
  const stepUp = useStepUpAction();
  const changes = AUDIENCES.flatMap((audience) =>
    METHODS.filter(
      (method) => request[audience][method] !== saved[audience][method],
    ).map((method) => ({ audience, method, on: request[audience][method] })),
  );

  const submit = async () => {
    // The revision binds the save to what was read: a newer save elsewhere answers 409.
    const body = { ...request, expectedRevision: revision };
    const result = await stepUp.run(
      { operation: "auth_local_methods_update", ...body },
      (token) => updateLocalAuthMethods(body, token),
    );
    if (!result.ok) return;
    queryClient.setQueryData(localAuthMethodsKey, result.value);
    toast.success(t("signInMethods.saved"));
    onSaved();
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !stepUp.busy) onClose();
      }}
      open
    >
      <DialogContent closeLabel={t("signInMethods.cancel")}>
        <DialogHeader>
          <DialogTitle>{t("signInMethods.confirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("signInMethods.confirmDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {changes.map((change) => (
              <li key={`${change.audience}-${change.method}`}>
                {t(
                  change.on
                    ? "signInMethods.changeOn"
                    : "signInMethods.changeOff",
                  {
                    method: t(`signInMethods.${change.method}`),
                    audience: t(
                      change.audience === "agent"
                        ? "signInMethods.staff"
                        : "signInMethods.customers",
                    ),
                  },
                )}
              </li>
            ))}
          </ul>
          <StepUpFields action={stepUp} idPrefix="sign-in-methods" />
          <FailureAlert
            failure={stepUp.failure}
            onReload={onReload}
            title={t("signInMethods.failed")}
          />
        </div>
        <DialogFooter>
          <Button
            disabled={stepUp.busy}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            {t("signInMethods.cancel")}
          </Button>
          <Button
            disabled={stepUp.busy || !stepUp.canRun}
            onClick={() => void submit()}
            type="button"
          >
            {stepUp.busy ? t("common.saving") : t("signInMethods.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

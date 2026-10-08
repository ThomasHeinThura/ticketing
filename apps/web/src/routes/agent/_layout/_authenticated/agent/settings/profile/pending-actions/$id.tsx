import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  getCurrentFactorStatus,
  type StepUpMethod,
} from "@/fetchers/god-mode/instance-users";
import {
  approveOwnDeactivation,
  cancelOwnPendingAction,
  createPendingActionProof,
  getOwnPendingAction,
} from "@/fetchers/pending-actions";
import { instanceUsersKey } from "@/hooks/queries/god-mode/use-instance-users";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/pending-actions/$id",
)({ component: PendingActionDetailRoute });

function PendingActionDetailRoute() {
  const { i18n, t } = useTranslation();
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [typedName, setTypedName] = useState("");
  const [secret, setSecret] = useState("");
  const [method, setMethod] = useState<StepUpMethod>("password");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useQuery({
    queryKey: ["me", "pending-action", id],
    queryFn: () => getOwnPendingAction(id),
  });
  const factor = useQuery({
    queryKey: ["god-mode", "step-up-factor"],
    queryFn: getCurrentFactorStatus,
    staleTime: 15_000,
  });
  useEffect(() => {
    if (factor.data) setMethod(factor.data.enabled ? "totp" : "password");
  }, [factor.data]);
  const approve = useMutation({
    mutationFn: approveOwnDeactivation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
        queryClient.invalidateQueries({
          queryKey: ["me", "pending-action", id],
        }),
        queryClient.invalidateQueries({
          queryKey: instanceUsersKey,
          refetchType: "all",
        }),
      ]);
    },
  });
  const cancel = useMutation({
    mutationFn: cancelOwnPendingAction,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
        queryClient.invalidateQueries({
          queryKey: ["me", "pending-action", id],
        }),
      ]);
    },
  });

  if (action.isLoading) {
    return (
      <main className="p-5 lg:p-8">
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }
  if (action.isError || !action.data) {
    return (
      <main className="space-y-4 p-5 lg:p-8">
        <PageTitle title={t("pendingActions:copy.a93eb80c8601")} />
        <p role="alert" className="text-sm text-destructive">
          {t("pendingActions:copy.85baf535b480")}
        </p>
        <Link to={routes.pendingActions.path as never}>
          {t("pendingActions:copy.c4c695a8da8e")}
        </Link>
      </main>
    );
  }

  const email =
    action.data.action === "delete" &&
    action.data.targetType === "user" &&
    typeof action.data.summary.email === "string"
      ? action.data.summary.email
      : null;
  const isPending = action.data.state === "pending";
  const canApprove =
    action.data.action === "delete" &&
    action.data.targetType === "user" &&
    action.data.confirmation === "typed_name_step_up" &&
    email !== null &&
    isPending;
  const factorUnavailable =
    factor.isLoading ||
    factor.isError ||
    !factor.data ||
    (factor.data.required && !factor.data.enabled);
  const effectiveMethod = factor.data?.enabled ? method : "password";

  async function approveDeactivation() {
    if (!email || typedName !== email) return;
    setError(null);
    try {
      const stepUpToken = await createPendingActionProof({
        pendingActionId: id,
        method: effectiveMethod,
        secret,
      });
      await approve.mutateAsync({ id, typedName, stepUpToken });
      setSecret("");
      setNotice(t("pendingActions:dynamic.deactivationApproved"));
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : undefined;
      setError(
        status === 400
          ? t("pendingActions:emailMismatch")
          : status === 409
            ? t("pendingActions:staleApproval")
            : t("pendingActions:approvalFailed"),
      );
      setSecret("");
    }
  }

  async function cancelAction() {
    setError(null);
    try {
      await cancel.mutateAsync(id);
      setNotice(t("pendingActions:dynamic.cancelled"));
    } catch {
      setError(t("pendingActions:dynamic.cancelFailed"));
    }
  }

  return (
    <main className="flex min-h-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={t("pendingActions:copy.a93eb80c8601")} />
      <header>
        <h1 className="text-2xl font-semibold">
          {action.data.action === "delete" && action.data.targetType === "user"
            ? t("pendingActions:dynamic.approveDeactivation")
            : t("pendingActions:dynamic.pendingAction")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pendingActions:dynamic.requestedFrom", {
            origin: t(`pendingActions:dynamic.origins.${action.data.origin}`),
          })}{" "}
          {new Date(action.data.expiresAt).toLocaleString(i18n.language)}.
        </p>
      </header>
      <Card>
        <CardContent className="space-y-4 py-5">
          <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">
              {t("pendingActions:copy.97c89a4d6630")}
            </dt>
            <dd>
              {action.data.action === "delete" &&
              action.data.targetType === "user"
                ? t("pendingActions:dynamic.deactivatePerson", { email: "" })
                : action.data.action.replaceAll("_", " ")}
            </dd>
            <dt className="text-muted-foreground">
              {t("pendingActions:copy.61ad50a9b918")}
            </dt>
            <dd>{email ?? action.data.targetIds.join(", ")}</dd>
            <dt className="text-muted-foreground">
              {t("pendingActions:copy.bae7d5be7082")}
            </dt>
            <dd>{t(`pendingActions:dynamic.states.${action.data.state}`)}</dd>
            {action.data.invalidationReason && (
              <>
                <dt className="text-muted-foreground">
                  {t("pendingActions:copy.f219cc0614ae")}
                </dt>
                <dd>
                  {t(
                    `pendingActions:dynamic.reasons.${action.data.invalidationReason}`,
                  )}
                </dd>
              </>
            )}
          </dl>
          {action.data.action === "delete" &&
            action.data.targetType === "user" && (
              <p className="text-sm text-muted-foreground">
                {t("pendingActions:copy.71f269fe7eee")}
              </p>
            )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {action.data.action === "delete" &&
            action.data.targetType === "user" &&
            !isPending && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("pendingActions:requestFreshDeactivation")}
                </p>
                <Button
                  variant="outline"
                  render={<Link to={routes.godModeUsers.path as never} />}
                >
                  {t("pendingActions:openUsers")}
                </Button>
              </div>
            )}
          {canApprove && (
            <div className="space-y-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="confirm-current-email">
                  {t("pendingActions:copy.c65f42061785")}
                </Label>
                <Input
                  id="confirm-current-email"
                  autoComplete="off"
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{email}</p>
              </div>
              {factor.data?.enabled && (
                <div className="space-y-2">
                  <Label htmlFor="pending-action-step-up-method">
                    {t("pendingActions:copy.3a725803c822")}
                  </Label>
                  <Select
                    value={method}
                    onValueChange={(value) =>
                      setMethod(
                        value === "backup_code" ? "backup_code" : "totp",
                      )
                    }
                  >
                    <SelectTrigger id="pending-action-step-up-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="totp">
                        {t("pendingActions:copy.2908b4e9c428")}
                      </SelectItem>
                      <SelectItem value="backup_code">
                        {t("pendingActions:copy.2a8367498e23")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="pending-action-step-up-secret">
                  {t(
                    effectiveMethod === "password"
                      ? "pendingActions:dynamic.accountPassword"
                      : effectiveMethod === "totp"
                        ? "pendingActions:dynamic.authenticatorCode"
                        : "pendingActions:dynamic.backupCode",
                  )}
                </Label>
                <Input
                  id="pending-action-step-up-secret"
                  type={effectiveMethod === "password" ? "password" : "text"}
                  autoComplete={
                    effectiveMethod === "password"
                      ? "current-password"
                      : "one-time-code"
                  }
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                />
              </div>
              {factorUnavailable && (
                <Alert variant="error">
                  <AlertTitle>
                    {t("pendingActions:copy.02c7fa45ff1a")}
                  </AlertTitle>
                  <AlertDescription>
                    {t("pendingActions:copy.8a8c6877113f")}
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    approve.isPending ||
                    factorUnavailable ||
                    typedName !== email ||
                    secret.length === 0
                  }
                  onClick={() => void approveDeactivation()}
                >
                  {t("pendingActions:copy.a2b52d875e8b")}
                </Button>
                <Button
                  variant="outline"
                  disabled={cancel.isPending || approve.isPending}
                  onClick={() => void cancelAction()}
                >
                  {t("pendingActions:copy.84837a216817")}
                </Button>
              </div>
            </div>
          )}
          {isPending && !canApprove && (
            <Alert>
              <AlertTitle>{t("pendingActions:copy.e76b511b0a44")}</AlertTitle>
              <AlertDescription>
                {t("pendingActions:copy.d3d84fb23a45")}
              </AlertDescription>
            </Alert>
          )}
          {!isPending && (
            <Link to={routes.pendingActions.path as never}>
              {t("pendingActions:copy.c4c695a8da8e")}
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

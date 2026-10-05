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
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/pending-actions/$id",
)({ component: PendingActionDetailRoute });

function PendingActionDetailRoute() {
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
        <PageTitle title="Pending action" />
        <p role="alert" className="text-sm text-destructive">
          This pending action could not be loaded or is no longer available.
        </p>
        <Link to={routes.pendingActions.path as never}>
          Back to pending actions
        </Link>
      </main>
    );
  }

  const email =
    action.data.action === "user_deactivation" &&
    typeof action.data.summary.email === "string"
      ? action.data.summary.email
      : null;
  const isPending = action.data.state === "pending";
  const canApprove =
    action.data.action === "user_deactivation" &&
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
      setNotice(
        "The approved deactivation completed. The user's active session was revoked.",
      );
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : undefined;
      setError(
        status === 400
          ? "The exact current email did not match. The request remains pending."
          : status === 409
            ? "The account or approval changed. Reload to see its current state."
            : "Approval could not be completed. Verify your details and try again.",
      );
      setSecret("");
    }
  }

  async function cancelAction() {
    setError(null);
    try {
      await cancel.mutateAsync(id);
      setNotice("The pending action was cancelled.");
    } catch {
      setError(
        "This action could not be cancelled. Reload to see its current state.",
      );
    }
  }

  return (
    <main className="flex min-h-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title="Pending action" />
      <header>
        <h1 className="text-2xl font-semibold">
          {action.data.action === "user_deactivation"
            ? "Approve person deactivation"
            : "Pending action"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requested from {action.data.origin}; expires{" "}
          {new Date(action.data.expiresAt).toLocaleString()}.
        </p>
      </header>
      <Card>
        <CardContent className="space-y-4 py-5">
          <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">Action</dt>
            <dd>{action.data.action.replaceAll("_", " ")}</dd>
            <dt className="text-muted-foreground">Target</dt>
            <dd>{email ?? action.data.targetIds.join(", ")}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{action.data.state.replaceAll("_", " ")}</dd>
            {action.data.invalidationReason && (
              <>
                <dt className="text-muted-foreground">Reason</dt>
                <dd>{action.data.invalidationReason.replaceAll("_", " ")}</dd>
              </>
            )}
          </dl>
          {action.data.action === "user_deactivation" && (
            <p className="text-sm text-muted-foreground">
              Approval deactivates the person, ends memberships, and revokes the
              account's current sessions and native API keys. This cannot be
              undone by unsuspending the account.
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
          {canApprove && (
            <div className="space-y-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="confirm-current-email">
                  Type the exact current email
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
                    Fresh authentication
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
                      <SelectItem value="totp">Authenticator code</SelectItem>
                      <SelectItem value="backup_code">Backup code</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="pending-action-step-up-secret">
                  {effectiveMethod === "password"
                    ? "Account password"
                    : effectiveMethod === "totp"
                      ? "Authenticator code"
                      : "Backup code"}
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
                  <AlertTitle>Fresh authentication unavailable</AlertTitle>
                  <AlertDescription>
                    Check your security-factor setup before approving this
                    action.
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
                  Approve and deactivate
                </Button>
                <Button
                  variant="outline"
                  disabled={cancel.isPending || approve.isPending}
                  onClick={() => void cancelAction()}
                >
                  Cancel request
                </Button>
              </div>
            </div>
          )}
          {isPending && !canApprove && (
            <Alert>
              <AlertTitle>Approval flow unavailable</AlertTitle>
              <AlertDescription>
                This action remains pending. Its registered confirmation flow is
                not part of this screen.
              </AlertDescription>
            </Alert>
          )}
          {!isPending && (
            <Link to={routes.pendingActions.path as never}>
              Back to pending actions
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

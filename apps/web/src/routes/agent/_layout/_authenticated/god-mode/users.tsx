import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/components/page-title";
import {
  createUserOperationProof,
  getCurrentFactorStatus,
  type InstanceUser,
} from "@/fetchers/god-mode/instance-users";
import {
  useInstanceUser,
  useInstanceUserActions,
  useInstanceUsers,
} from "@/hooks/queries/god-mode/use-instance-users";
import { HttpError } from "@/lib/http-error";
import { type GodModeUsersSearch, parseGodModeUsersSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/god-mode/users")({
  validateSearch: parseGodModeUsersSearch,
  component: InstanceUsersPage,
});

type Action =
  | "suspend"
  | "unsuspend"
  | "grant-admin"
  | "reset-mfa"
  | "sign-out"
  | null;

function InstanceUsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const filters = useMemo(
    () => ({
      limit: "50",
      ...(search.q ? { q: search.q } : {}),
      ...(search.side ? { side: search.side } : {}),
      ...(search.active ? { active: search.active } : {}),
      ...(search.organisationId
        ? { organisationId: search.organisationId }
        : {}),
      ...(search.cursor ? { cursor: search.cursor } : {}),
    }),
    [
      search.active,
      search.cursor,
      search.organisationId,
      search.q,
      search.side,
    ],
  );
  const directory = useInstanceUsers(filters);
  const selected = useInstanceUser(search.user);
  const actions = useInstanceUserActions();
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [method, setMethod] = useState<"password" | "totp" | "backup_code">(
    "password",
  );
  const [secret, setSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const factor = useQuery({
    queryKey: ["god-mode", "step-up-factor"],
    queryFn: getCurrentFactorStatus,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (factor.data) {
      setMethod(factor.data.enabled ? "totp" : "password");
    }
  }, [factor.data]);

  const navigateSearch = (patch: Partial<GodModeUsersSearch>) => {
    void navigate({
      search: (current: GodModeUsersSearch) => ({ ...current, ...patch }),
      replace: true,
    });
  };
  const resetAction = () => {
    setAction(null);
    setReason("");
    setExpiresAt("");
    setVerificationNote("");
    setSecret("");
    setFormError(null);
  };

  async function runAction(user: InstanceUser) {
    setFormError(null);
    try {
      if (action === "suspend") {
        await actions.suspend.mutateAsync({
          id: user.id,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(expiresAt
            ? { expiresAt: new Date(expiresAt).toISOString() }
            : {}),
        });
      } else if (action === "unsuspend") {
        await actions.unsuspend.mutateAsync(user.id);
      } else if (action === "sign-out") {
        await actions.signOut.mutateAsync(user.id);
      } else if (action === "grant-admin") {
        const token = await createUserOperationProof({
          operation: "instance_admin_grant",
          userId: user.id,
          method,
          secret,
        });
        await actions.grantAdmin.mutateAsync({ id: user.id, token });
      } else if (action === "reset-mfa") {
        const note = verificationNote.trim();
        const token = await createUserOperationProof({
          operation: "mfa_reset",
          userId: user.id,
          verificationNote: note,
          method,
          secret,
        });
        await actions.resetMfa.mutateAsync({
          id: user.id,
          verificationNote: note,
          token,
        });
      } else {
        return;
      }
      setNotice(
        action === "suspend"
          ? "Account suspended. Existing sessions and personal keys were revoked."
          : action === "unsuspend"
            ? "Account suspension cleared. Previously revoked sessions and keys remain revoked."
            : action === "sign-out"
              ? "All current sessions for this account were signed out."
              : action === "grant-admin"
                ? "Instance administrator access granted."
                : "The authenticator factor was reset.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["god-mode", "instance-users"],
      });
      resetAction();
    } catch (error) {
      const status = error instanceof HttpError ? error.status : undefined;
      setFormError(
        status === 409
          ? "The account changed while you were working. Reload and try again."
          : status === 503
            ? "The required notification service is unavailable. No account change was made."
            : "The action could not be completed. Check the details and try again.",
      );
      setSecret("");
    }
  }

  const isPending =
    actions.suspend.isPending ||
    actions.unsuspend.isPending ||
    actions.signOut.isPending ||
    actions.grantAdmin.isPending ||
    actions.resetMfa.isPending;

  return (
    <main className="flex min-h-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title="Instance users" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Instance users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search and manage accounts across this instance.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void directory.refetch()}
          disabled={directory.isFetching}
        >
          Refresh
        </Button>
      </header>

      {notice && (
        <p className="text-sm text-foreground" role="status">
          {notice}
        </p>
      )}

      <section aria-label="User filters" className="flex flex-wrap gap-3">
        <Input
          aria-label="Search users"
          className="w-full sm:max-w-sm"
          value={search.q ?? ""}
          placeholder="Search name or email"
          onChange={(event) =>
            navigateSearch({ q: event.target.value, cursor: undefined })
          }
        />
        <Select
          value={search.side ?? "all"}
          onValueChange={(value) =>
            navigateSearch({
              side:
                value === "staff" || value === "customer" ? value : undefined,
              cursor: undefined,
            })
          }
        >
          <SelectTrigger aria-label="Filter by account type" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All account types</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={search.active ?? "all"}
          onValueChange={(value) =>
            navigateSearch({
              active: value === "true" || value === "false" ? value : undefined,
              cursor: undefined,
            })
          }
        >
          <SelectTrigger aria-label="Filter by person status" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="true">Active people</SelectItem>
            <SelectItem value="false">Inactive people</SelectItem>
          </SelectContent>
        </Select>
        <Input
          aria-label="Filter by organisation ID"
          className="w-full sm:max-w-64"
          value={search.organisationId ?? ""}
          placeholder="Organisation ID"
          onChange={(event) =>
            navigateSearch({
              organisationId: event.target.value || undefined,
              cursor: undefined,
            })
          }
        />
      </section>

      {directory.isPending ? (
        <div role="status" aria-label="Loading users" className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : directory.isError ? (
        <Alert variant="error" role="alert">
          <AlertTitle>Users are unavailable</AlertTitle>
          <AlertDescription>
            <p>We could not load the instance directory.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void directory.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : directory.data.data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="font-medium">No users found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Change or clear the current filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
          <Card className="min-w-0 overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directory.data.data.map((user) => (
                    <TableRow
                      key={user.id}
                      data-state={
                        search.user === user.id ? "selected" : undefined
                      }
                      className="cursor-pointer"
                      onClick={() => navigateSearch({ user: user.id })}
                    >
                      <TableCell>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      </TableCell>
                      <TableCell>{user.person?.side ?? "Unlinked"}</TableCell>
                      <TableCell>
                        {user.person?.organisationName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.isInstanceAdmin && <Badge>Administrator</Badge>}
                          {user.isSuspended && (
                            <Badge variant="destructive">Suspended</Badge>
                          )}
                          {user.person && !user.person.active && (
                            <Badge variant="outline">Inactive</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  {directory.data.data.length} users on this page
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !directory.data.page.hasMore || directory.isFetching
                  }
                  onClick={() =>
                    navigateSearch({
                      cursor: directory.data.page.nextCursor ?? undefined,
                    })
                  }
                >
                  Next page
                </Button>
              </div>
            </CardContent>
          </Card>

          {search.user && (
            <UserDetails
              user={selected.data}
              isLoading={selected.isPending}
              isError={selected.isError}
              onClose={() => navigateSearch({ user: undefined })}
              onAction={setAction}
            />
          )}
        </div>
      )}

      {action && selected.data && (
        <UserActionDialog
          action={action}
          user={selected.data}
          open
          pending={isPending}
          formError={formError}
          reason={reason}
          expiresAt={expiresAt}
          verificationNote={verificationNote}
          method={method}
          secret={secret}
          factor={factor.data}
          onReason={setReason}
          onExpiresAt={setExpiresAt}
          onVerificationNote={setVerificationNote}
          onMethod={setMethod}
          onSecret={setSecret}
          onCancel={resetAction}
          onSubmit={() => void runAction(selected.data as InstanceUser)}
        />
      )}
    </main>
  );
}

function UserDetails({
  user,
  isLoading,
  isError,
  onClose,
  onAction,
}: {
  user: InstanceUser | undefined;
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
  onAction: (action: Action) => void;
}) {
  if (isLoading)
    return (
      <Card role="status" aria-label="Loading user details">
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  if (isError || !user)
    return (
      <Alert variant="error" role="alert">
        <AlertTitle>User details unavailable</AlertTitle>
        <AlertDescription>
          Reload the directory and select the account again.
        </AlertDescription>
      </Alert>
    );
  const eligibleForAdmin =
    user.person?.side === "staff" &&
    user.person.active &&
    !user.person.isPlaceholder &&
    !user.isSuspended &&
    !user.isInstanceAdmin;
  return (
    <Card className="h-fit" data-testid="instance-user-details">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold">{user.name}</h2>
            <p className="break-all text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <Separator />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Account</dt>
          <dd>{user.person?.side ?? "Unlinked"}</dd>
          <dt className="text-muted-foreground">Organisation</dt>
          <dd>{user.person?.organisationName ?? "—"}</dd>
          <dt className="text-muted-foreground">Person status</dt>
          <dd>
            {user.person
              ? user.person.active
                ? "Active"
                : "Inactive"
              : "No linked person"}
          </dd>
          <dt className="text-muted-foreground">Two-factor</dt>
          <dd>{user.twoFactorEnabled ? "Enabled" : "Not enabled"}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>
            {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
              new Date(user.createdAt),
            )}
          </dd>
        </dl>
        <Separator />
        <div className="grid gap-2">
          {user.isSuspended ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("suspend")}
            >
              Update suspension
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("suspend")}
            >
              Suspend account
            </Button>
          )}
          {user.isSuspended && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("unsuspend")}
            >
              Unsuspend account
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction("sign-out")}
          >
            Sign out all sessions
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!user.twoFactorEnabled}
            onClick={() => onAction("reset-mfa")}
          >
            Reset MFA
          </Button>
          {!user.isInstanceAdmin && (
            <Button
              size="sm"
              disabled={!eligibleForAdmin}
              onClick={() => onAction("grant-admin")}
            >
              Grant instance admin
            </Button>
          )}
          {!eligibleForAdmin && !user.isInstanceAdmin && (
            <p className="text-xs text-muted-foreground">
              Admin access is available only for an active, linked staff
              account. The server checks eligibility again before granting.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function UserActionDialog({
  action,
  user,
  open,
  pending,
  formError,
  reason,
  expiresAt,
  verificationNote,
  method,
  secret,
  factor,
  onReason,
  onExpiresAt,
  onVerificationNote,
  onMethod,
  onSecret,
  onCancel,
  onSubmit,
}: {
  action: Exclude<Action, null>;
  user: InstanceUser;
  open: boolean;
  pending: boolean;
  formError: string | null;
  reason: string;
  expiresAt: string;
  verificationNote: string;
  method: "password" | "totp" | "backup_code";
  secret: string;
  factor:
    | { enabled: boolean; required: boolean; bootstrapRequired: boolean }
    | undefined;
  onReason: (value: string) => void;
  onExpiresAt: (value: string) => void;
  onVerificationNote: (value: string) => void;
  onMethod: (value: "password" | "totp" | "backup_code") => void;
  onSecret: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const isStepUp = action === "grant-admin" || action === "reset-mfa";
  const factorBlocked =
    isStepUp && (!factor || (factor.required && !factor.enabled));
  const canSubmit =
    !pending &&
    (!isStepUp || (!factorBlocked && secret.length > 0)) &&
    (action !== "reset-mfa" || verificationNote.trim().length >= 12) &&
    (action !== "suspend" || Array.from(reason).length <= 500);
  const titles: Record<Exclude<Action, null>, string> = {
    suspend: "Suspend account",
    unsuspend: "Unsuspend account",
    "grant-admin": "Grant instance administrator",
    "reset-mfa": "Reset authenticator factor",
    "sign-out": "Sign out all sessions",
  };
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{titles[action]}</DialogTitle>
          <DialogDescription>
            {user.name} · {user.email}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          {action === "suspend" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="suspension-reason">Reason (optional)</Label>
                <Input
                  id="suspension-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(event) => onReason(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="suspension-expiry">Expiry (optional)</Label>
                <Input
                  id="suspension-expiry"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => onExpiresAt(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for an indefinite suspension. Existing sessions
                  and personal keys are revoked.
                </p>
              </div>
            </>
          )}
          {action === "unsuspend" && (
            <p className="text-sm">
              This clears the account suspension. Previously revoked sessions
              and personal keys are not restored.
            </p>
          )}
          {action === "sign-out" && (
            <p className="text-sm">
              This revokes every current session for this account, including
              impersonation sessions. API keys and account status are unchanged.
            </p>
          )}
          {action === "grant-admin" && (
            <p className="text-sm">
              Fresh authentication is required. The server rechecks that this is
              an eligible active staff account.
            </p>
          )}
          {action === "reset-mfa" && (
            <div className="space-y-2">
              <Label htmlFor="mfa-verification-note">
                Identity verification note
              </Label>
              <Input
                id="mfa-verification-note"
                minLength={12}
                maxLength={1000}
                value={verificationNote}
                onChange={(event) => onVerificationNote(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This note is bound to the fresh-authentication proof. It is
                included in the existing reset audit record.
              </p>
            </div>
          )}
          {isStepUp &&
            (factor?.enabled ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="step-up-method">Verification method</Label>
                  <Select
                    value={method}
                    onValueChange={(value) =>
                      onMethod(value === "backup_code" ? "backup_code" : "totp")
                    }
                  >
                    <SelectTrigger id="step-up-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="totp">Authenticator code</SelectItem>
                      <SelectItem value="backup_code">Backup code</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="step-up-code">
                    {method === "totp" ? "Authenticator code" : "Backup code"}
                  </Label>
                  <Input
                    id="step-up-code"
                    autoComplete="one-time-code"
                    value={secret}
                    onChange={(event) => onSecret(event.target.value)}
                  />
                </div>
              </>
            ) : factor && !factor.required ? (
              <div className="space-y-2">
                <Label htmlFor="step-up-password">Current password</Label>
                <Input
                  id="step-up-password"
                  type="password"
                  autoComplete="current-password"
                  value={secret}
                  onChange={(event) => onSecret(event.target.value)}
                />
              </div>
            ) : (
              <Alert variant="error">
                <AlertTitle>Fresh authentication unavailable</AlertTitle>
                <AlertDescription>
                  Complete required authenticator enrollment before this action.
                </AlertDescription>
              </Alert>
            ))}
          {formError && (
            <Alert variant="error" role="alert">
              <AlertTitle>Action not completed</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={
              action === "suspend" || action === "sign-out"
                ? "destructive"
                : "default"
            }
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {pending
              ? "Working…"
              : action === "sign-out"
                ? "Sign out sessions"
                : titles[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

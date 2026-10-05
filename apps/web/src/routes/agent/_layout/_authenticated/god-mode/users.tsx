import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { useTranslation } from "react-i18next";
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
  | "deactivate"
  | null;

function InstanceUsersPage() {
  const { t } = useTranslation();
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
  const [pendingActionUrl, setPendingActionUrl] = useState<string | null>(null);
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
      } else if (action === "deactivate") {
        const result = await actions.deactivate.mutateAsync(user.id);
        if (!("approveUrl" in result)) {
          throw new Error(t("instanceUsers:dynamic.approvalMissing"));
        }
        setPendingActionUrl(result.approveUrl);
        setNotice(t("instanceUsers:dynamic.deactivationRequested"));
        resetAction();
        return;
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
      const noticeKey =
        action === "suspend"
          ? "suspended"
          : action === "unsuspend"
            ? "unsuspended"
            : action === "sign-out"
              ? "signedOut"
              : action === "grant-admin"
                ? "adminGranted"
                : "mfaReset";
      setNotice(t(`instanceUsers:dynamic.notices.${noticeKey}`));
      await queryClient.invalidateQueries({
        queryKey: ["god-mode", "instance-users"],
      });
      resetAction();
    } catch (error) {
      const status = error instanceof HttpError ? error.status : undefined;
      setFormError(
        t(
          status === 409
            ? "instanceUsers:dynamic.errors.accountChanged"
            : status === 503
              ? "instanceUsers:dynamic.errors.notificationUnavailable"
              : "instanceUsers:dynamic.errors.actionFailed",
        ),
      );
      setSecret("");
    }
  }

  const isPending =
    actions.suspend.isPending ||
    actions.unsuspend.isPending ||
    actions.signOut.isPending ||
    actions.deactivate.isPending ||
    actions.grantAdmin.isPending ||
    actions.resetMfa.isPending;

  return (
    <main className="flex min-h-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={t("instanceUsers:copy.d094be66b726")} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("instanceUsers:copy.d094be66b726")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("instanceUsers:copy.211715f3fe3d")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void directory.refetch()}
          disabled={directory.isFetching}
        >
          {t("instanceUsers:copy.56e3badc4e6c")}
        </Button>
      </header>

      {notice && (
        <p className="text-sm text-foreground" role="status">
          {notice}{" "}
          {pendingActionUrl && (
            <Link className="underline" to={pendingActionUrl as never}>
              {t("instanceUsers:copy.ad11be6e92db")}
            </Link>
          )}
        </p>
      )}
      <Link
        className="text-sm underline"
        to={"/agent/settings/profile/pending-actions" as never}
      >
        {t("instanceUsers:copy.8008829bb5ed")}
      </Link>

      <section
        aria-label={t("instanceUsers:copy.4f6c2db66053")}
        className="flex flex-wrap gap-3"
      >
        <Input
          aria-label={t("instanceUsers:copy.1bd6226dd199")}
          className="w-full sm:max-w-sm"
          value={search.q ?? ""}
          placeholder={t("instanceUsers:copy.5d12419516ef")}
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
          <SelectTrigger
            aria-label={t("instanceUsers:copy.4dc97a606e2f")}
            className="w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("instanceUsers:copy.ec137488beec")}
            </SelectItem>
            <SelectItem value="staff">
              {t("instanceUsers:copy.a4730a22cf49")}
            </SelectItem>
            <SelectItem value="customer">
              {t("instanceUsers:copy.0e85749a6f40")}
            </SelectItem>
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
          <SelectTrigger
            aria-label={t("instanceUsers:copy.dd5947e50ac8")}
            className="w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("instanceUsers:copy.6405179d241b")}
            </SelectItem>
            <SelectItem value="true">
              {t("instanceUsers:copy.274e10cde2d6")}
            </SelectItem>
            <SelectItem value="false">
              {t("instanceUsers:copy.c51407d28beb")}
            </SelectItem>
          </SelectContent>
        </Select>
        <Input
          aria-label={t("instanceUsers:copy.b745c3cd8743")}
          className="w-full sm:max-w-64"
          value={search.organisationId ?? ""}
          placeholder={t("instanceUsers:copy.5f2c539d453e")}
          onChange={(event) =>
            navigateSearch({
              organisationId: event.target.value || undefined,
              cursor: undefined,
            })
          }
        />
      </section>

      {directory.isPending ? (
        <div
          role="status"
          aria-label={t("instanceUsers:copy.352046dda7cf")}
          className="space-y-3"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : directory.isError ? (
        <Alert variant="error" role="alert">
          <AlertTitle>{t("instanceUsers:copy.a93b05eaba35")}</AlertTitle>
          <AlertDescription>
            <p>{t("instanceUsers:copy.5de26f1895d9")}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void directory.refetch()}
            >
              {t("instanceUsers:copy.9f5cd8a2e880")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : directory.data.data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="font-medium">
              {t("instanceUsers:copy.612eb3c64c41")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("instanceUsers:copy.82457330d2e6")}
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
                    <TableHead>
                      {t("instanceUsers:copy.9f8a2389a20c")}
                    </TableHead>
                    <TableHead>
                      {t("instanceUsers:copy.3deb74565196")}
                    </TableHead>
                    <TableHead>
                      {t("instanceUsers:copy.6e99c1d3b150")}
                    </TableHead>
                    <TableHead>
                      {t("instanceUsers:copy.bae7d5be7082")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directory.data.data.map((user) => (
                    <TableRow
                      key={user.id}
                      data-state={
                        search.user === user.id ? "selected" : undefined
                      }
                    >
                      <TableCell>
                        <Link
                          className="rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          to={Route.fullPath}
                          search={(current: GodModeUsersSearch) => ({
                            ...current,
                            user: user.id,
                          })}
                          aria-label={t("instanceUsers:selectUser", {
                            name: user.name,
                            email: user.email,
                          })}
                        >
                          <span className="block font-medium">{user.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {user.email}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        {user.person?.side
                          ? t(`instanceUsers:dynamic.side.${user.person.side}`)
                          : t("instanceUsers:dynamic.unlinked")}
                      </TableCell>
                      <TableCell>
                        {user.person?.organisationName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.isInstanceAdmin && (
                            <Badge>
                              {t("instanceUsers:copy.1eda23758be9")}
                            </Badge>
                          )}
                          {user.isSuspended && (
                            <Badge variant="destructive">
                              {t("instanceUsers:copy.794696a72066")}
                            </Badge>
                          )}
                          {user.person && !user.person.active && (
                            <Badge variant="outline">
                              {t("instanceUsers:copy.09af574c7f20")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  {t("instanceUsers:dynamic.usersOnPage", {
                    count: directory.data.data.length,
                  })}
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
                  {t("instanceUsers:copy.4bfc194b68a3")}
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
  const { t } = useTranslation();
  if (isLoading)
    return (
      <Card role="status" aria-label={t("instanceUsers:copy.4135684d2d0a")}>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  if (isError || !user)
    return (
      <Alert variant="error" role="alert">
        <AlertTitle>{t("instanceUsers:copy.2dc7a078a492")}</AlertTitle>
        <AlertDescription>
          {t("instanceUsers:copy.db0e0e9d496c")}
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
            {t("instanceUsers:copy.bbfa773e5a63")}
          </Button>
        </div>
        <Separator />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">
            {t("instanceUsers:copy.85dfa32c97d8")}
          </dt>
          <dd>
            {user.person?.side
              ? t(`instanceUsers:dynamic.side.${user.person.side}`)
              : t("instanceUsers:dynamic.unlinked")}
          </dd>
          <dt className="text-muted-foreground">
            {t("instanceUsers:copy.6e99c1d3b150")}
          </dt>
          <dd>{user.person?.organisationName ?? "—"}</dd>
          <dt className="text-muted-foreground">
            {t("instanceUsers:copy.886f2447688e")}
          </dt>
          <dd>
            {user.person
              ? t(
                  user.person.active
                    ? "instanceUsers:dynamic.personActive"
                    : "instanceUsers:dynamic.personInactive",
                )
              : t("instanceUsers:dynamic.noLinkedPerson")}
          </dd>
          <dt className="text-muted-foreground">
            {t("instanceUsers:copy.fae11b81f599")}
          </dt>
          <dd>
            {t(
              user.twoFactorEnabled
                ? "instanceUsers:dynamic.enabled"
                : "instanceUsers:dynamic.notEnabled",
            )}
          </dd>
          <dt className="text-muted-foreground">
            {t("instanceUsers:copy.accf40c89baa")}
          </dt>
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
              {t("instanceUsers:copy.1e1ba090dab9")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("suspend")}
            >
              {t("instanceUsers:copy.6361cbb3f6ca")}
            </Button>
          )}
          {user.isSuspended && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("unsuspend")}
            >
              {t("instanceUsers:copy.c4d18ce42e74")}
            </Button>
          )}
          {user.person?.active && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onAction("deactivate")}
            >
              {t("instanceUsers:copy.eb3c0567a3f7")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction("sign-out")}
          >
            {t("instanceUsers:copy.f70b8a00f6fb")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!user.twoFactorEnabled}
            onClick={() => onAction("reset-mfa")}
          >
            {t("instanceUsers:copy.0c1fff37e9d6")}
          </Button>
          {!user.isInstanceAdmin && (
            <Button
              size="sm"
              disabled={!eligibleForAdmin}
              onClick={() => onAction("grant-admin")}
            >
              {t("instanceUsers:copy.d6ac6adb7aa6")}
            </Button>
          )}
          {!eligibleForAdmin && !user.isInstanceAdmin && (
            <p className="text-xs text-muted-foreground">
              {t("instanceUsers:copy.9b3e95464b4a")}
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
  factor: { enabled: boolean; required: boolean } | undefined;
  onReason: (value: string) => void;
  onExpiresAt: (value: string) => void;
  onVerificationNote: (value: string) => void;
  onMethod: (value: "password" | "totp" | "backup_code") => void;
  onSecret: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const isStepUp = action === "grant-admin" || action === "reset-mfa";
  const factorBlocked =
    isStepUp && (!factor || (factor.required && !factor.enabled));
  const canSubmit =
    !pending &&
    (!isStepUp || (!factorBlocked && secret.length > 0)) &&
    (action !== "reset-mfa" || verificationNote.trim().length >= 12) &&
    (action !== "suspend" || Array.from(reason).length <= 500);
  const titles: Record<Exclude<Action, null>, string> = {
    suspend: t("instanceUsers:dynamic.actions.suspend"),
    unsuspend: t("instanceUsers:dynamic.actions.unsuspend"),
    "grant-admin": t("instanceUsers:dynamic.actions.grantAdmin"),
    "reset-mfa": t("instanceUsers:dynamic.actions.resetMfa"),
    "sign-out": t("instanceUsers:dynamic.actions.signOut"),
    deactivate: t("instanceUsers:dynamic.actions.deactivate"),
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
                <Label htmlFor="suspension-reason">
                  {t("instanceUsers:copy.f6826f8fc9b4")}
                </Label>
                <Input
                  id="suspension-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(event) => onReason(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="suspension-expiry">
                  {t("instanceUsers:copy.728bac665663")}
                </Label>
                <Input
                  id="suspension-expiry"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => onExpiresAt(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("instanceUsers:copy.5f1d7b5a1d87")}
                </p>
              </div>
            </>
          )}
          {action === "unsuspend" && (
            <p className="text-sm">{t("instanceUsers:copy.711c48ecc613")}</p>
          )}
          {action === "sign-out" && (
            <p className="text-sm">{t("instanceUsers:copy.7648a80e2e1a")}</p>
          )}
          {action === "deactivate" && (
            <p className="text-sm">{t("instanceUsers:copy.83cee4a5b3db")}</p>
          )}
          {action === "grant-admin" && (
            <p className="text-sm">{t("instanceUsers:copy.d20b1e22f25a")}</p>
          )}
          {action === "reset-mfa" && (
            <div className="space-y-2">
              <Label htmlFor="mfa-verification-note">
                {t("instanceUsers:copy.e45a0de86960")}
              </Label>
              <Input
                id="mfa-verification-note"
                minLength={12}
                maxLength={1000}
                value={verificationNote}
                onChange={(event) => onVerificationNote(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("instanceUsers:copy.18422bfc5104")}
              </p>
            </div>
          )}
          {isStepUp &&
            (factor?.enabled ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="step-up-method">
                    {t("instanceUsers:copy.fc7481906e3b")}
                  </Label>
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
                      <SelectItem value="totp">
                        {t("instanceUsers:copy.2908b4e9c428")}
                      </SelectItem>
                      <SelectItem value="backup_code">
                        {t("instanceUsers:copy.2a8367498e23")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="step-up-code">
                    {t(
                      method === "totp"
                        ? "instanceUsers:dynamic.authenticatorCode"
                        : "instanceUsers:dynamic.backupCode",
                    )}
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
                <Label htmlFor="step-up-password">
                  {t("instanceUsers:copy.19dff4dad0a7")}
                </Label>
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
                <AlertTitle>{t("instanceUsers:copy.02c7fa45ff1a")}</AlertTitle>
                <AlertDescription>
                  {t("instanceUsers:copy.d5d49ba4b1bf")}
                </AlertDescription>
              </Alert>
            ))}
          {formError && (
            <Alert variant="error" role="alert">
              <AlertTitle>{t("instanceUsers:copy.f169620795e0")}</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {t("instanceUsers:copy.77dfd2135f4d")}
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
              ? t("instanceUsers:dynamic.working")
              : action === "sign-out"
                ? t("instanceUsers:dynamic.signOutSessions")
                : titles[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  type CustomerInvitation,
  type CustomerInvitationStatus,
  createCustomerInvitation,
  listCustomerInvitations,
  listInvitableOrganisations,
  requestCustomerInvitationRevoke,
  resendCustomerInvitation,
} from "@/fetchers/customer-invitation";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

export const customerOrganisationsKey = (workspaceId: string) =>
  ["customer-invitation-organisations", workspaceId] as const;
export const customerInvitationsKey = (
  workspaceId: string,
  organisationId: string,
) => ["customer-invitations", workspaceId, organisationId] as const;

const STATUS_VARIANT: Record<
  CustomerInvitationStatus,
  "info" | "success" | "secondary" | "warning"
> = {
  pending: "info",
  accepted: "success",
  revoked: "secondary",
  expired: "warning",
};

function InviteDialog({
  workspaceId,
  organisationId,
  onClose,
}: {
  workspaceId: string;
  organisationId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createCustomerInvitation(workspaceId, organisationId, email),
    onSuccess: async (sent) => {
      await queryClient.invalidateQueries({
        queryKey: customerInvitationsKey(workspaceId, organisationId),
      });
      if (sent.delivered) toast.success(t("customerInvitations:toasts.sent"));
      else toast.error(t("customerInvitations:toasts.notDelivered"));
      onClose();
    },
  });
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("customerInvitations:create.title")}</DialogTitle>
          <DialogDescription>
            {t("customerInvitations:create.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !mutation.isPending) mutation.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="customer-invitation-email">
                {t("customerInvitations:create.email")}
              </Label>
              <Input
                id="customer-invitation-email"
                type="email"
                autoFocus
                required
                maxLength={320}
                value={email}
                disabled={mutation.isPending}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("customerInvitations:create.roleNote")}
              </p>
            </div>
            {mutation.error ? (
              <Alert variant="error">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !valid}>
              {t("customerInvitations:create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvitationRow({
  invitation,
  workspaceId,
  organisationId,
}: {
  invitation: CustomerInvitation;
  workspaceId: string;
  organisationId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const resend = useMutation({
    mutationFn: () =>
      resendCustomerInvitation(workspaceId, organisationId, invitation.id),
    onSuccess: async (sent) => {
      await queryClient.invalidateQueries({
        queryKey: customerInvitationsKey(workspaceId, organisationId),
      });
      if (sent.delivered) toast.success(t("customerInvitations:toasts.resent"));
      else toast.error(t("customerInvitations:toasts.notDelivered"));
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: () => requestCustomerInvitationRevoke(invitation.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(error.message),
  });
  const open =
    invitation.status === "pending" || invitation.status === "expired";
  return (
    <TableRow>
      <TableCell className="font-medium">{invitation.email}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[invitation.status]}>
          {t(`customerInvitations:status.${invitation.status}`)}
        </Badge>
      </TableCell>
      <TableCell>
        {invitation.lastSentAt ? formatDateTime(invitation.lastSentAt) : "-"}
      </TableCell>
      <TableCell>{formatDateTime(invitation.expiresAt)}</TableCell>
      <TableCell className="text-right">
        {open ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={resend.isPending}
              onClick={() => resend.mutate()}
            >
              {t("customerInvitations:actions.resend")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              {t("customerInvitations:actions.revoke")}
            </Button>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

/**
 * `docs/screens.md` "Workspace — customer invitations": invite an address into one customer
 * organisation (always the customer role), see every invitation with its status, resend a pending
 * one and request its revocation through the pending-action flow (CP-20, CP-22, CP-23).
 */
export function CustomerInvitations({
  organisationId,
}: {
  organisationId: string | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { canInviteUsers, isCheckingPermissions } = useWorkspacePermission();
  const canInvite = canInviteUsers() && !isCheckingPermissions;
  const workspaceId = workspace?.id ?? "";
  const organisations = useQuery({
    queryKey: customerOrganisationsKey(workspaceId),
    queryFn: () => listInvitableOrganisations(workspaceId),
    enabled: Boolean(workspaceId) && canInvite,
  });
  const selected = organisations.data?.find((o) => o.id === organisationId);
  const invitations = useQuery({
    queryKey: customerInvitationsKey(workspaceId, selected?.id ?? ""),
    queryFn: () => listCustomerInvitations(workspaceId, selected?.id ?? ""),
    enabled: Boolean(workspaceId) && Boolean(selected),
  });
  const [inviting, setInviting] = useState(false);
  const loading =
    workspaceLoading || isCheckingPermissions || organisations.isLoading;

  return (
    <>
      <PageTitle title={t("customerInvitations:title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              {t("customerInvitations:title")}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("customerInvitations:description")}
            </p>
          </div>
          {canInvite && selected ? (
            <Button onClick={() => setInviting(true)}>
              <Plus aria-hidden="true" />
              {t("customerInvitations:invite")}
            </Button>
          ) : null}
        </div>
        {loading ? (
          <div
            role="status"
            aria-label={t("customerInvitations:loading")}
            className="space-y-3"
          >
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !canInvite ? (
          <Alert variant="info">
            <AlertTitle>{t("customerInvitations:denied.title")}</AlertTitle>
            <AlertDescription>
              {t("customerInvitations:denied.description")}
            </AlertDescription>
          </Alert>
        ) : organisations.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("customerInvitations:loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("customerInvitations:loadErrorDescription")}
              <Button
                className="w-fit"
                onClick={() => void organisations.refetch()}
              >
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="max-w-sm space-y-2">
              <Label htmlFor="customer-invitation-organisation">
                {t("customerInvitations:organisation.label")}
              </Label>
              <Select
                value={selected?.id ?? null}
                onValueChange={(value) =>
                  void navigate({
                    to: routes.customerInvitations.path,
                    search: value ? { organisation: value } : {},
                  })
                }
              >
                <SelectTrigger id="customer-invitation-organisation">
                  <SelectValue>
                    {selected?.name ??
                      t("customerInvitations:organisation.choose")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(organisations.data ?? []).map((organisation) => (
                    <SelectItem key={organisation.id} value={organisation.id}>
                      {organisation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!selected ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {t("customerInvitations:organisation.emptyTitle")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("customerInvitations:organisation.emptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : invitations.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : invitations.isError ? (
              <Alert variant="error">
                <AlertTitle>
                  {t("customerInvitations:loadErrorTitle")}
                </AlertTitle>
                <AlertDescription>
                  {t("customerInvitations:loadErrorDescription")}
                  <Button
                    className="w-fit"
                    onClick={() => void invitations.refetch()}
                  >
                    <RefreshCw aria-hidden="true" />
                    {t("common:actions.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : invitations.data?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("customerInvitations:columns.email")}
                    </TableHead>
                    <TableHead>
                      {t("customerInvitations:columns.status")}
                    </TableHead>
                    <TableHead>
                      {t("customerInvitations:columns.sent")}
                    </TableHead>
                    <TableHead>
                      {t("customerInvitations:columns.expires")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("customerInvitations:columns.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.data.map((invitation) => (
                    <InvitationRow
                      key={invitation.id}
                      invitation={invitation}
                      workspaceId={workspaceId}
                      organisationId={selected.id}
                    />
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("customerInvitations:emptyTitle")}</EmptyTitle>
                  <EmptyDescription>
                    {t("customerInvitations:emptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </>
        )}
      </div>
      {inviting && workspace && selected ? (
        <InviteDialog
          workspaceId={workspace.id}
          organisationId={selected.id}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </>
  );
}

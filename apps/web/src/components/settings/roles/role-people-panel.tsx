import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RoleApiError,
  reassignRole,
  requestRoleDeletion,
  type WorkspaceRoleDetail,
} from "@/fetchers/workspace-roles";
import { workspaceRolesKey } from "@/hooks/queries/workspace/use-workspace-roles";
import {
  roleDetailKey,
  roleHoldersKey,
  useRoleHolders,
} from "@/hooks/queries/workspace-roles/use-role-queries";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { toast } from "@/lib/toast";

/**
 * RL-8: the people who hold the role, a bulk reassignment (everyone or the ticked people) and
 * role deletion. Deleting needs every holder moved first; the delete itself is a pending action
 * the requester approves, so nothing is removed from this screen.
 */
export function RolePeoplePanel({
  workspaceId,
  role,
  roles,
  callerRank,
  canManageMembers,
  canManageRoles,
}: {
  workspaceId: string;
  role: WorkspaceRoleDetail;
  roles: readonly WorkspaceRoleDetail[];
  callerRank: number;
  canManageMembers: boolean;
  canManageRoles: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const holders = useRoleHolders(workspaceId, role.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Owner is never a target or a source (ownership moves only through the transfer flow), and
  // nothing at or above the caller's own rank is offered (the API refuses it too).
  const targets = roles.filter(
    (candidate) =>
      candidate.id !== role.id &&
      candidate.role !== "owner" &&
      candidate.rank < callerRank,
  );
  const chosen = targets.find((candidate) => candidate.id === target);
  const canMove =
    canManageMembers && role.role !== "owner" && role.rank < callerRank;
  const people = holders.data?.holders ?? [];
  const movingAll = selected.length === 0;
  const movingCount = movingAll ? people.length : selected.length;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: roleHoldersKey(workspaceId, role.id),
      }),
      queryClient.invalidateQueries({
        queryKey: roleDetailKey(workspaceId, role.id),
      }),
      queryClient.invalidateQueries({
        queryKey: workspaceRolesKey(workspaceId),
      }),
      queryClient.invalidateQueries({ queryKey: ["workspace-members"] }),
    ]);
  };

  const move = useMutation({
    mutationFn: () => {
      if (!target) throw new Error("No target role");
      return reassignRole(workspaceId, role.id, {
        toRoleId: target,
        ...(movingAll ? {} : { userIds: selected }),
      });
    },
    onSuccess: async (result) => {
      setConfirming(false);
      setSelected([]);
      setTarget(null);
      await refresh();
      toast.success(t("roles:people.moved", { count: result.moved }));
    },
  });

  const remove = useMutation({
    mutationFn: () => requestRoleDeletion(workspaceId, role.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(error.message),
  });

  const moveError = move.error instanceof RoleApiError ? move.error : null;
  const canDelete = canManageRoles && !role.isSystem;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("roles:people.title")}</CardTitle>
          <CardDescription>
            {t("roles:people.description", { count: role.holderCount })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {holders.isLoading ? (
            <div role="status" aria-label={t("roles:people.loading")}>
              <Skeleton className="h-24 w-full" />
            </div>
          ) : holders.isError ? (
            <Alert variant="error">
              <AlertTitle>{t("roles:people.errorTitle")}</AlertTitle>
              <AlertDescription>
                <Button
                  className="w-fit"
                  onClick={() => void holders.refetch()}
                >
                  <RefreshCw aria-hidden="true" />
                  {t("common:actions.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : people.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("roles:people.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("roles:people.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {canMove ? (
                    <TableHead className="w-10">
                      <span className="sr-only">
                        {t("roles:people.select")}
                      </span>
                    </TableHead>
                  ) : null}
                  <TableHead>{t("roles:people.person")}</TableHead>
                  <TableHead>{t("roles:people.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.userId}>
                    {canMove ? (
                      <TableCell>
                        <Checkbox
                          aria-label={t("roles:people.selectPerson", {
                            name: person.name,
                          })}
                          checked={selected.includes(person.userId)}
                          onCheckedChange={(checked) =>
                            setSelected((current) =>
                              checked === true
                                ? [...current, person.userId]
                                : current.filter((id) => id !== person.userId),
                            )
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <div className="font-medium text-sm">{person.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {person.email}
                      </div>
                    </TableCell>
                    <TableCell className="space-x-1">
                      {person.suspended ? (
                        <Badge variant="warning">
                          {t("roles:people.suspended")}
                        </Badge>
                      ) : !person.active ? (
                        <Badge variant="outline">
                          {t("roles:people.deactivated")}
                        </Badge>
                      ) : (
                        <Badge variant="success">
                          {t("roles:people.active")}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {canMove && people.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1 space-y-2">
                <Label htmlFor="role-move-target">
                  {t("roles:people.moveTo")}
                </Label>
                <Select
                  value={target}
                  disabled={move.isPending || targets.length === 0}
                  onValueChange={(value) =>
                    setTarget(typeof value === "string" ? value : null)
                  }
                >
                  <SelectTrigger id="role-move-target">
                    <SelectValue>
                      {chosen?.name ?? t("roles:people.chooseRole")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!target || move.isPending}
                onClick={() => setConfirming(true)}
              >
                {movingAll
                  ? t("roles:people.moveAll")
                  : t("roles:people.moveSelected", { count: selected.length })}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canDelete ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("roles:delete.title")}</CardTitle>
            <CardDescription>{t("roles:delete.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {role.holderCount > 0 ? (
              <Alert variant="info">
                <AlertTitle>{t("roles:delete.blockedTitle")}</AlertTitle>
                <AlertDescription>
                  {t("roles:delete.blockedDescription", {
                    count: role.holderCount,
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              variant="destructive"
              disabled={role.holderCount > 0 || remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t("roles:delete.action")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {confirming ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !move.isPending) setConfirming(false);
          }}
        >
          <DialogContent closeLabel={t("common:actions.close")}>
            <DialogHeader>
              <DialogTitle>{t("roles:people.confirmTitle")}</DialogTitle>
              <DialogDescription>
                {t("roles:people.confirmDescription", {
                  count: movingCount,
                  from: role.name,
                  to: chosen?.name ?? "",
                })}
              </DialogDescription>
            </DialogHeader>
            {moveError ? (
              <div className="px-6">
                <Alert variant="error">
                  <AlertTitle>
                    {t(`roles:errors.${moveError.code ?? "generic"}`, {
                      defaultValue: t("roles:errors.generic"),
                    })}
                  </AlertTitle>
                  <AlertDescription>{moveError.message}</AlertDescription>
                </Alert>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={move.isPending}
                onClick={() => setConfirming(false)}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button disabled={move.isPending} onClick={() => move.mutate()}>
                {t("roles:people.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

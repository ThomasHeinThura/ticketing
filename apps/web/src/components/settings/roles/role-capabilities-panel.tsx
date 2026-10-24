import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CapabilityMatrix,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@taskdesk/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import {
  RoleApiError,
  updateRole,
  type WorkspaceRoleDetail,
} from "@/fetchers/workspace-roles";
import { workspaceRolesKey } from "@/hooks/queries/workspace/use-workspace-roles";
import { roleDetailKey } from "@/hooks/queries/workspace-roles/use-role-queries";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { toast } from "@/lib/toast";
import {
  capabilityClosure,
  capabilityLabel,
  describeCapability,
  ROLE_CAPABILITY_ITEMS,
  requiredByMap,
} from "./capability-model";
import type { RoleDraftState } from "./role-draft";

export type RoleEditAuthority = {
  roleKey: string | undefined;
  rank: number;
  held: ReadonlySet<string>;
  canManageRoles: boolean;
};

/** RL-4: nothing at or above your own rank is editable, except the role you hold yourself. */
export function canEditRole(
  role: Pick<WorkspaceRoleDetail, "role" | "rank" | "isEditable">,
  authority: RoleEditAuthority,
): boolean {
  if (!role.isEditable || !authority.canManageRoles) return false;
  return role.rank < authority.rank || role.role === authority.roleKey;
}

/**
 * The role editor (RL-1 to RL-5, RL-9, RL-10 save flow): the grouped capability matrix with a
 * plain-English line for each, ticking auto-ticks what it implies and says so, what you cannot
 * grant is disabled with the reason, and a save names how many people it changes immediately.
 */
export function RoleCapabilitiesPanel({
  workspaceId,
  role,
  authority,
  state,
  onReload,
}: {
  workspaceId: string;
  role: WorkspaceRoleDetail;
  authority: RoleEditAuthority;
  state: RoleDraftState;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { draft, setDraft, effective, changes, dirty, reset } = state;
  const editable = canEditRole(role, authority);
  const isOwnRole = role.role === authority.roleKey;
  const isBuiltIn = role.isSystem;
  const [autoAdded, setAutoAdded] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");

  const rankNumber = Number(draft.rank);
  const maxRank = Math.max(1, authority.rank - 1);
  const rankValid =
    isBuiltIn ||
    (Number.isInteger(rankNumber) && rankNumber >= 1 && rankNumber <= maxRank);
  const nameValid = draft.name.trim().length > 0;
  const removesOwn = isOwnRole && changes.removed.length > 0;

  const requiredBy = useMemo(
    () => requiredByMap(draft.explicit),
    [draft.explicit],
  );

  const { disabled, reasons } = useMemo(() => {
    const disabledIds: string[] = [];
    const disabledReasons: Record<string, string> = {};
    const selected = new Set(effective);
    for (const item of ROLE_CAPABILITY_ITEMS) {
      if (!editable) {
        disabledIds.push(item.id);
        continue;
      }
      const requirers = requiredBy[item.id];
      if (selected.has(item.id) && requirers && requirers.length > 0) {
        disabledIds.push(item.id);
        disabledReasons[item.id] = t("roles:matrix.requiredBy", {
          names: requirers.map(capabilityLabel).join(", "),
        });
        continue;
      }
      // RL-3: a capability you do not hold yourself cannot be granted.
      if (!selected.has(item.id) && !authority.held.has(item.id)) {
        disabledIds.push(item.id);
        disabledReasons[item.id] = t("roles:matrix.notHeld");
      }
    }
    return { disabled: disabledIds, reasons: disabledReasons };
  }, [authority.held, editable, effective, requiredBy, t]);

  // RL-4/GM-2: saving a role is elevated, so the save spends a fresh, single-use verification
  // bound to exactly this change. A refusal of the write itself (rank guard, stale version, ...)
  // still reaches the role-specific error handling below untouched.
  const stepUp = useStepUpAction();
  const save = useMutation({
    mutationFn: async () => {
      const input = {
        capabilities: capabilityClosure(draft.explicit),
        description: draft.description.trim() || null,
        ...(isBuiltIn
          ? {}
          : { name: draft.name.trim(), rank: Number(draft.rank) }),
        expectedVersion: role.version,
      };
      const outcome = await stepUp.run(
        {
          operation: "workspace_role_update",
          workspaceId,
          roleId: role.id,
          ...input,
        },
        (token) =>
          updateRole(
            workspaceId,
            role.id,
            { ...input, ...(removesOwn ? { confirmSelfEdit: true } : {}) },
            token,
          ),
        { writeErrors: "rethrow" },
      );
      if (!outcome.ok)
        throw new Error(t("roles:stepUp.failedTitle"), { cause: "step_up" });
      return outcome.value;
    },
    onSuccess: async () => {
      setConfirming(false);
      setTypedName("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: roleDetailKey(workspaceId, role.id),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceRolesKey(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["workspace-role-history", workspaceId, role.id],
        }),
      ]);
      toast.success(t("roles:save.saved"));
    },
  });

  const error = save.error instanceof RoleApiError ? save.error : null;

  return (
    <div className="space-y-6">
      {!editable ? (
        <Alert variant="info">
          <AlertTitle>{t("roles:readOnly.title")}</AlertTitle>
          <AlertDescription>
            {!role.isEditable
              ? t("roles:readOnly.notEditable")
              : !authority.canManageRoles
                ? t("roles:readOnly.noPermission")
                : t("roles:readOnly.rank")}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("roles:details.title")}</CardTitle>
          <CardDescription>
            {isBuiltIn
              ? t("roles:details.descriptionBuiltIn")
              : t("roles:details.descriptionCustom")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role-edit-name">{t("roles:fields.name")}</Label>
            <Input
              id="role-edit-name"
              maxLength={100}
              value={draft.name}
              disabled={!editable || isBuiltIn || save.isPending}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-edit-rank">{t("roles:fields.rank")}</Label>
            <Input
              id="role-edit-rank"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxRank}
              step={1}
              value={draft.rank}
              aria-invalid={!rankValid}
              disabled={!editable || isBuiltIn || save.isPending}
              onChange={(event) =>
                setDraft({ ...draft, rank: event.target.value })
              }
            />
            <p className="text-muted-foreground text-xs">
              {isBuiltIn
                ? t("roles:fields.rankFixed")
                : t("roles:fields.rankHelp", { max: maxRank })}
            </p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="role-edit-description">
              {t("roles:fields.description")}
            </Label>
            <Textarea
              id="role-edit-description"
              maxLength={500}
              value={draft.description}
              disabled={!editable || save.isPending}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </div>
        </CardContent>
      </Card>

      {autoAdded.length > 0 ? (
        <Alert variant="info">
          <AlertTitle>{t("roles:matrix.impliedTitle")}</AlertTitle>
          <AlertDescription>
            {t("roles:matrix.impliedDescription", {
              names: autoAdded.map(capabilityLabel).join(", "),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <CapabilityMatrix
        aria-label={t("roles:matrix.label")}
        items={ROLE_CAPABILITY_ITEMS.map((item) => ({
          id: item.id,
          label: item.label,
          description: item.description,
          group: item.group,
        }))}
        selected={effective}
        disabled={disabled}
        disabledReasons={reasons}
        onSelectedChange={(next) => {
          const before = new Set(effective);
          const ticked = next.filter((id) => !before.has(id));
          const nextExplicit = [
            ...draft.explicit.filter((id) => next.includes(id)),
            ...ticked,
          ];
          const closure = capabilityClosure(nextExplicit);
          setAutoAdded(
            closure.filter((id) => !before.has(id) && !ticked.includes(id)),
          );
          setDraft({ ...draft, explicit: nextExplicit });
        }}
      />

      {error ? (
        <Alert variant="error">
          <AlertTitle>
            {t(`roles:errors.${error.code ?? "generic"}`, {
              defaultValue: t("roles:errors.generic"),
            })}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <span>{error.message}</span>
            {error.code === "role_changed" ? (
              <Button
                className="w-fit"
                variant="outline"
                onClick={() => {
                  save.reset();
                  onReload();
                }}
              >
                {t("roles:errors.reload")}
              </Button>
            ) : null}
            {error.code === "beyond_own_authority" &&
            Array.isArray(error.body?.capabilities) ? (
              <ul className="list-disc ps-5">
                {(error.body.capabilities as string[]).map((id) => (
                  <li key={id}>{describeCapability(id)}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {editable ? (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background py-3">
          <Button
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setAutoAdded([]);
              save.reset();
              reset();
            }}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={!dirty || !rankValid || !nameValid || save.isPending}
            onClick={() => setConfirming(true)}
          >
            {t("roles:save.action")}
          </Button>
        </div>
      ) : null}

      {confirming ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !save.isPending) setConfirming(false);
          }}
        >
          <DialogContent closeLabel={t("common:actions.close")}>
            <DialogHeader>
              <DialogTitle>{t("roles:save.confirmTitle")}</DialogTitle>
              <DialogDescription>
                {t("roles:save.immediate", { count: role.holderCount })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-6">
              {changes.added.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium text-sm">{t("roles:save.added")}</p>
                  <ul className="list-disc ps-5 text-sm">
                    {changes.added.map((id) => (
                      <li key={id}>{capabilityLabel(id)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {changes.removed.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium text-sm">
                    {t("roles:save.removed")}
                  </p>
                  <ul className="list-disc ps-5 text-sm">
                    {changes.removed.map((id) => (
                      <li key={id}>{capabilityLabel(id)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {removesOwn ? (
                <Alert variant="warning">
                  <AlertTitle>{t("roles:save.selfTitle")}</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <span>{t("roles:save.selfDescription")}</span>
                    <Label htmlFor="role-self-confirm">
                      {t("roles:save.selfType", { name: role.name })}
                    </Label>
                    <Input
                      id="role-self-confirm"
                      value={typedName}
                      autoComplete="off"
                      onChange={(event) => setTypedName(event.target.value)}
                    />
                  </AlertDescription>
                </Alert>
              ) : null}
              <StepUpFields action={stepUp} idPrefix="save-role" />
              <FailureAlert
                failure={stepUp.failure}
                title={t("roles:stepUp.failedTitle")}
              />
              {save.error && save.error.cause !== "step_up" ? (
                <Alert variant="error">
                  <AlertDescription>{save.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={() => setConfirming(false)}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                disabled={
                  save.isPending ||
                  !stepUp.secret ||
                  (removesOwn && typedName.trim() !== role.name)
                }
                onClick={() => save.mutate()}
              >
                {t("roles:save.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

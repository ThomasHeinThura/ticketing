import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
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
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import { createRole } from "@/fetchers/workspace-roles";
import {
  type WorkspaceRole,
  workspaceRolesKey,
} from "@/hooks/queries/workspace/use-workspace-roles";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { routes } from "@/lib/routes";

const NOTHING = "__nothing__";

/**
 * Create a role from nothing or by cloning one (the clone is independent: no inheritance). A new
 * role's rank defaults below the caller's own, and the API refuses anything at or above it
 * (RL-14); the input is bounded to what it already knows will be accepted.
 */
export function CreateRoleDialog({
  workspaceId,
  roles,
  callerRank,
  onClose,
}: {
  workspaceId: string;
  roles: readonly WorkspaceRole[];
  callerRank: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rank, setRank] = useState(
    String(Math.max(1, Math.min(30, callerRank - 1))),
  );
  const [cloneFrom, setCloneFrom] = useState<string>(NOTHING);

  const maxRank = Math.max(1, callerRank - 1);
  const rankNumber = Number(rank);
  const rankValid =
    Number.isInteger(rankNumber) && rankNumber >= 1 && rankNumber <= maxRank;
  const duplicate = roles.some(
    (role) => role.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  // RL-1/GM-2: creating a role is elevated, so the create spends a fresh, single-use
  // verification bound to exactly this role.
  const stepUp = useStepUpAction();
  const mutation = useMutation({
    mutationFn: async () => {
      const input = {
        role: name.trim(),
        description: description.trim() || null,
        rank: rankNumber,
        ...(cloneFrom === NOTHING ? {} : { cloneFromRoleId: cloneFrom }),
      };
      const outcome = await stepUp.run(
        { operation: "workspace_role_create", workspaceId, ...input },
        (token) => createRole(workspaceId, input, token),
        { writeErrors: "rethrow" },
      );
      if (!outcome.ok)
        throw new Error(t("roles:stepUp.failedTitle"), { cause: "step_up" });
      return outcome.value;
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: workspaceRolesKey(workspaceId),
      });
      onClose();
      void navigate({
        to: routes.workspaceRoleDetail.path,
        params: { id: created.id },
      });
    },
  });
  const source = roles.find((role) => role.id === cloneFrom);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("roles:create.title")}</DialogTitle>
          <DialogDescription>{t("roles:create.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              name.trim() &&
              rankValid &&
              stepUp.canRun &&
              !mutation.isPending
            )
              mutation.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="role-name">{t("roles:fields.name")}</Label>
              <Input
                id="role-name"
                autoFocus
                required
                maxLength={100}
                value={name}
                disabled={mutation.isPending}
                onChange={(event) => setName(event.target.value)}
              />
              {duplicate ? (
                <p className="text-muted-foreground text-xs">
                  {t("roles:create.duplicateWarning")}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-description">
                {t("roles:fields.description")}
              </Label>
              <Textarea
                id="role-description"
                maxLength={500}
                value={description}
                disabled={mutation.isPending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-clone">{t("roles:create.startFrom")}</Label>
              <Select
                value={cloneFrom}
                disabled={mutation.isPending}
                onValueChange={(value) => {
                  if (typeof value === "string") setCloneFrom(value);
                }}
              >
                <SelectTrigger id="role-clone">
                  <SelectValue>
                    {source?.name ?? t("roles:create.fromNothing")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOTHING}>
                    {t("roles:create.fromNothing")}
                  </SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {t("roles:create.cloneHelp")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-rank">{t("roles:fields.rank")}</Label>
              <Input
                id="role-rank"
                type="number"
                inputMode="numeric"
                min={1}
                max={maxRank}
                step={1}
                value={rank}
                disabled={mutation.isPending}
                aria-invalid={!rankValid}
                onChange={(event) => setRank(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("roles:fields.rankHelp", { max: maxRank })}
              </p>
            </div>
            <StepUpFields action={stepUp} idPrefix="create-role" />
            <FailureAlert
              failure={stepUp.failure}
              title={t("roles:stepUp.failedTitle")}
            />
            {mutation.error && mutation.error.cause !== "step_up" ? (
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
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                !name.trim() ||
                !rankValid ||
                !stepUp.canRun
              }
            >
              {t("roles:create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation } from "@tanstack/react-query";
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
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createFreeze,
  type Freeze,
  updateFreeze,
} from "@/fetchers/service-management";
import { useInvalidateServiceManagement } from "@/hooks/queries/service-management";
import { fromDateTimeLocal, MutationError, toDateTimeLocal } from "./shared";

/** CH-4: declare or edit a workspace-level change freeze. Shows how many changes it now blocks. */
export function FreezeDialog({
  workspaceId,
  freeze,
  onClose,
}: {
  workspaceId: string;
  /** Present when editing. */
  freeze?: Freeze;
  onClose: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const [name, setName] = useState(freeze?.name ?? "");
  const [reason, setReason] = useState(freeze?.reason ?? "");
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(freeze?.startsAt));
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(freeze?.endsAt));
  const [affected, setAffected] = useState<number | null>(null);
  const start = fromDateTimeLocal(startsAt);
  const end = fromDateTimeLocal(endsAt);
  const rangeValid = Boolean(start && end && new Date(end) > new Date(start));
  const save = useMutation({
    mutationFn: () =>
      freeze
        ? updateFreeze(freeze.id, {
            name: name.trim(),
            reason: reason.trim() || null,
            startsAt: start ?? undefined,
            endsAt: end ?? undefined,
            version: freeze.version,
          })
        : createFreeze(workspaceId, {
            name: name.trim(),
            reason: reason.trim() || null,
            startsAt: start ?? "",
            endsAt: end ?? "",
          }),
    onSuccess: async (result) => {
      await invalidate();
      if (result.affectedChanges > 0) setAffected(result.affectedChanges);
      else onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {freeze ? t("freezes.edit.title") : t("freezes.create.title")}
          </DialogTitle>
          <DialogDescription>
            {t("freezes.create.description")}
          </DialogDescription>
        </DialogHeader>
        {affected !== null ? (
          <div className="space-y-4 px-6">
            <Alert variant="warning">
              <AlertDescription>
                {t("freezes.affected", { count: affected })}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={onClose}>{t("common.close")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && rangeValid && !save.isPending) save.mutate();
            }}
          >
            <div className="space-y-4 px-6">
              <div className="space-y-2">
                <Label htmlFor="freeze-name">{t("freezes.fields.name")}</Label>
                <Input
                  id="freeze-name"
                  autoFocus
                  required
                  maxLength={160}
                  value={name}
                  disabled={save.isPending}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="freeze-reason">
                  {t("freezes.fields.reason")}
                </Label>
                <Textarea
                  id="freeze-reason"
                  value={reason}
                  disabled={save.isPending}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="freeze-start">
                    {t("freezes.fields.startsAt")}
                  </Label>
                  <Input
                    id="freeze-start"
                    type="datetime-local"
                    required
                    value={startsAt}
                    disabled={save.isPending}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="freeze-end">
                    {t("freezes.fields.endsAt")}
                  </Label>
                  <Input
                    id="freeze-end"
                    type="datetime-local"
                    required
                    value={endsAt}
                    disabled={save.isPending}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </div>
              </div>
              {startsAt && endsAt && !rangeValid ? (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {t("freezes.rangeInvalid")}
                </p>
              ) : null}
              <MutationError error={save.error} />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                disabled={save.isPending}
                onClick={onClose}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={save.isPending || !name.trim() || !rangeValid}
              >
                {freeze ? t("common.save") : t("freezes.create.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

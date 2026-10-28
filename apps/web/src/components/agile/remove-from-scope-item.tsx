import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ContextMenuItem } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { removeCycleWorkItem, removeModuleWorkItem } from "@/fetchers/agile";
import { toast } from "@/lib/toast";
import type { ScopedMembership } from "./scoped-membership-context";

/** "Remove from cycle / module" row action of the cycle and module detail work surfaces. */
export function RemoveFromScopeItem({
  membership,
  itemKey,
  onClose,
}: {
  membership: ScopedMembership;
  itemKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("agile");
  const cache = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      membership.kind === "cycle"
        ? removeCycleWorkItem(membership.id, itemKey)
        : removeModuleWorkItem(membership.id, itemKey),
    onSuccess: async () => {
      toast.success(t(`remove.done.${membership.kind}`, { key: itemKey }));
      await cache.invalidateQueries({ queryKey: ["agile"] });
      await cache.invalidateQueries({ queryKey: ["work-items"] });
    },
    onError: () => toast.error(t("remove.failed")),
  });
  return (
    <ContextMenuItem
      disabled={remove.isPending}
      onClick={() => {
        remove.mutate();
        onClose();
      }}
    >
      <span>{t(`remove.action.${membership.kind}`)}</span>
    </ContextMenuItem>
  );
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useUpdateWorkItemFields } from "./work-item-properties";

/**
 * Kaneo's borderless task title (`task-title.tsx`), saved to the work item after a short
 * pause with its version; an empty title is never sent.
 */
export default function WorkItemTitle({
  item,
  onAccessLost,
}: {
  item: WorkItemDetailRow;
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const { canUpdateTasks } = useWorkspacePermission(item.workspaceId);
  const update = useUpdateWorkItemFields(item, onAccessLost);
  const [value, setValue] = useState(item.title);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A newer server title (another tab, a reload after a conflict) replaces the field
  // unless the user is mid-edit.
  useEffect(() => {
    if (!timer.current) setValue(item.title);
  }, [item.title]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <input
      aria-label={t("workItems:properties.titleLabel")}
      className="block h-auto w-full appearance-none border-0 bg-transparent p-0 font-heading font-semibold text-[2rem] text-foreground leading-[1.15] tracking-[-0.02em] outline-none placeholder:text-foreground"
      type="text"
      value={value}
      readOnly={!canUpdateTasks()}
      placeholder={t("workItems:properties.titlePlaceholder")}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          const title = next.trim();
          if (title && title !== item.title) update.mutate({ title });
        }, 800);
      }}
    />
  );
}

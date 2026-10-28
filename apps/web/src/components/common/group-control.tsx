import { Button, DropdownMenu, DropdownMenuTrigger } from "@taskdesk/ui";
import { Layers } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectViewGroup } from "@/lib/project-board-search";

const loadGroupControlMenu = () => import("./group-control-menu");
const GroupControlMenu = lazy(loadGroupControlMenu);

type GroupControlProps<G extends ProjectViewGroup> = {
  group: G;
  onGroupChange: (group: G) => void;
  /** The groupings this view supports, in menu order. */
  groups: readonly G[];
  /** Resolved labels for registered custom fields (`cf.<key>`). */
  groupLabels?: Readonly<Record<string, string>>;
  /**
   * What the default grouping (`state`) is called. The board names it "Status"; a view with no
   * state grouping, such as the timeline, shows it as "None".
   */
  defaultLabel?: string;
};

/**
 * `VW-13` / `VW-27`: the toolbar's "Group" menu. Keep the Kaneo trigger in the initial
 * toolbar graph; download its popup content on focus/hover or the first open request.
 */
export default function GroupControl<G extends ProjectViewGroup>({
  group,
  onGroupChange,
  groups,
  defaultLabel,
  groupLabels,
}: GroupControlProps<G>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [contentRequested, setContentRequested] = useState(false);
  const isActive = group !== "state";

  const preloadMenuContent = () => {
    void loadGroupControlMenu().catch(() => {});
  };
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setContentRequested(true);
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        onFocus={preloadMenuContent}
        onPointerEnter={preloadMenuContent}
        render={
          <Button
            variant="ghost"
            type="button"
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none ring-0 ${
              isActive
                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-background text-foreground hover:bg-accent/60"
            }`}
          />
        }
      >
        <Layers className="h-3 w-3" />
        {isActive
          ? (groupLabels?.[group] ?? t(`tasks:group.fields.${group}`))
          : t("tasks:group.label")}
      </DropdownMenuTrigger>
      {contentRequested ? (
        <Suspense fallback={null}>
          <GroupControlMenu
            group={group}
            groups={groups}
            defaultLabel={defaultLabel}
            groupLabels={groupLabels}
            onGroupChange={(nextGroup) => {
              const supported = groups.find((entry) => entry === nextGroup);
              if (supported !== undefined) onGroupChange(supported);
            }}
          />
        </Suspense>
      ) : null}
    </DropdownMenu>
  );
}

import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { Check, Plus, Search, Tag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CREATE_TASK_PROPERTY_BUTTON_CLASS } from "@/components/shared/modals/create-task-presentation";
import useCreateLabel from "@/hooks/mutations/label/use-create-label";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { resolveLabelColor } from "@/lib/label-color";
import { toast } from "@/lib/toast";
import type { CreateWorkItemLabel } from "./use-create-work-item-options";

const COLORS = [
  { value: "gray", label: "stone", color: "var(--color-stone-500)" },
  { value: "dark-gray", label: "slate", color: "var(--color-slate-500)" },
  { value: "purple", label: "lavender", color: "var(--color-violet-500)" },
  { value: "teal", label: "sage", color: "var(--color-emerald-600)" },
  { value: "green", label: "forest", color: "var(--color-green-600)" },
  { value: "yellow", label: "amber", color: "var(--color-amber-600)" },
  { value: "orange", label: "terracotta", color: "var(--color-orange-600)" },
  { value: "pink", label: "rose", color: "var(--color-rose-600)" },
  { value: "red", label: "crimson", color: "var(--color-red-600)" },
] as const;
type Props = {
  workspaceId: string | undefined;
  projectId: string;
  labels: CreateWorkItemLabel[];
  labelIds: string[];
  onChange: (ids: string[]) => void;
  onCreated: (label: CreateWorkItemLabel) => void;
  onBusyChange: (busy: boolean) => void;
  onDraftChange: (dirty: boolean) => void;
  canUpdate: boolean;
  disabled: boolean;
  loading: boolean;
  error: boolean;
};
/** Original Kaneo search → create → colour flow; only the persisted catalogue ID enters the draft. */
export default function CreateWorkItemLabelPicker(props: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"select" | "color">("select");
  const [newName, setNewName] = useState("");
  const [selectedColor, setSelectedColor] = useState<string>("gray");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function resetPopoverContent() {
    setSearch("");
    setStep("select");
    setNewName("");
    setSelectedColor("gray");
    setError(false);
  }
  function closePopover() {
    setOpen(false);
    clearTimeout(closeTimer.current);
    const intent = lifecycle.capture();
    // Kaneo retains the current picker step until its closing motion finishes.
    closeTimer.current = setTimeout(() => {
      if (lifecycle.isCurrent(intent)) resetPopoverContent();
    }, 200);
  }
  const latest = useRef(props);
  latest.current = props;
  const permission = useWorkspacePermission(props.workspaceId);
  const canManage =
    !permission.isCheckingPermissions && permission.canManageLabels();
  const currentAuthority = useRef(canManage);
  currentAuthority.current = canManage;
  const { mutateAsync: createLabel } = useCreateLabel();
  const lifecycle = useIntentLifecycle(
    `${props.workspaceId}:${props.projectId}`,
    () => {
      clearTimeout(closeTimer.current);
      setSelectedColor("gray");
      setOpen(false);
      setSearch("");
      setStep("select");
      setNewName("");
      setSaving(false);
      setError(false);
      pending.current = false;
      latest.current.onBusyChange(false);
      latest.current.onDraftChange(false);
    },
  );
  useEffect(() => {
    props.onDraftChange(Boolean(search.trim() || newName.trim()));
  }, [search, newName, props.onDraftChange]);
  useEffect(
    () => () => {
      clearTimeout(closeTimer.current);
      latest.current.onBusyChange(false);
      latest.current.onDraftChange(false);
    },
    [],
  );
  const filtered = props.labels.filter((label) =>
    label.name.toLowerCase().includes(search.toLowerCase()),
  );
  const isNew =
    Boolean(search.trim()) &&
    !props.labels.some(
      (label) => label.name.toLowerCase() === search.trim().toLowerCase(),
    );
  const unavailable = props.disabled || saving || !props.canUpdate;
  async function persist(color: string) {
    if (
      pending.current ||
      !canManage ||
      unavailable ||
      !newName.trim() ||
      !props.workspaceId
    )
      return;
    pending.current = true;
    setSaving(true);
    setError(false);
    setSelectedColor(color);
    props.onBusyChange(true);
    const intent = lifecycle.capture();
    const workspaceId = props.workspaceId;
    try {
      const created = await createLabel({
        name: newName.trim(),
        color,
        workspaceId,
      });
      if (!lifecycle.isCurrent(intent)) return;
      if (!currentAuthority.current || !latest.current.canUpdate)
        throw new Error("Label authority changed");
      if (
        created.workspaceId !== workspaceId ||
        created.taskId !== null ||
        !created.id
      )
        throw new Error("Label response is outside this catalogue");
      latest.current.onCreated({ ...created, projectId: null });
      toast.success(t("common:modals.createTask.labelCreated"));
      closePopover();
    } catch {
      if (!lifecycle.isCurrent(intent)) return;
      setError(true);
      toast.error(t("common:modals.createTask.labelCreateError"));
    } finally {
      if (lifecycle.isCurrent(intent)) {
        pending.current = false;
        setSaving(false);
        latest.current.onBusyChange(false);
      }
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (saving) return;
        if (value) {
          clearTimeout(closeTimer.current);
          setOpen(true);
        } else closePopover();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t("common:modals.createTask.labels")}
          data-testid="create-work-item-labels-trigger"
          disabled={
            props.disabled || !props.canUpdate || props.loading || props.error
          }
          className={cn(
            CREATE_TASK_PROPERTY_BUTTON_CLASS,
            props.labelIds.length
              ? "bg-accent/30 text-foreground"
              : "text-muted-foreground",
          )}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>{t("common:modals.createTask.labels")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        {step === "select" ? (
          <div className="w-auto">
            <div className="flex items-center gap-2 p-2 border-b border-border">
              <Search className="w-3 h-3 text-muted-foreground" />
              <Input
                unstyled
                nativeInput
                value={search}
                disabled={unavailable}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("common:modals.createTask.searchLabels")}
                aria-label={t("common:modals.createTask.searchLabels")}
                className="relative inline-flex min-w-0 flex-1 w-full"
                nativeInputClassName="w-full bg-transparent border-none text-foreground text-xs focus:outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="py-1">
              {filtered.length === 0 && !search ? (
                <span className="text-xs text-muted-foreground px-2">
                  {t("common:modals.createTask.noLabelsFound")}
                </span>
              ) : null}
              {filtered.map((label) => (
                <Button
                  key={label.id}
                  type="button"
                  variant="ghost"
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                  disabled={unavailable}
                  onClick={() =>
                    props.onChange(
                      props.labelIds.includes(label.id)
                        ? props.labelIds.filter((id) => id !== label.id)
                        : [...props.labelIds, label.id],
                    )
                  }
                >
                  <div className="flex-shrink-0 w-3 flex justify-center">
                    {props.labelIds.includes(label.id) ? (
                      <Check className="w-3 h-3" />
                    ) : null}
                  </div>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: resolveLabelColor(label.color) }}
                  />
                  <span className="max-w-20 truncate">{label.name}</span>
                </Button>
              ))}
              {canManage && isNew && filtered.length > 0 ? (
                <div className="border-t border-border my-1" />
              ) : null}
              {canManage && isNew ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                  disabled={unavailable}
                  onClick={() => {
                    setNewName(search);
                    setStep("color");
                    setError(false);
                  }}
                >
                  <div className="flex-shrink-0 w-3 flex justify-center">
                    <Plus className="w-3 h-3" />
                  </div>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: COLORS.find(
                        (color) => color.value === selectedColor,
                      )?.color,
                    }}
                  />
                  <span className="truncate">
                    {t("common:modals.createTask.createLabel", {
                      name: search,
                    })}
                  </span>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="w-auto">
            <div className="flex items-center justify-between p-2 border-b border-border">
              <span className="text-xs font-medium">
                {t("common:modals.createTask.chooseColor")}
              </span>
              <Button
                type="button"
                variant="ghost"
                aria-label={t("common:actions.cancel")}
                disabled={unavailable}
                onClick={() => setStep("select")}
                className="w-4 h-4 flex items-center justify-center hover:bg-accent/50 rounded"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="py-1">
              {COLORS.map((color) => (
                <Button
                  key={color.value}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left",
                    selectedColor === color.value && "bg-accent/30",
                  )}
                  disabled={unavailable || !canManage}
                  onClick={() => persist(color.value)}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color.color }}
                  />
                  <span className="truncate">
                    {t(`common:modals.createTask.labelColors.${color.label}`)}
                  </span>
                  {selectedColor === color.value ? (
                    <Check className="w-3 h-3 ml-auto" />
                  ) : null}
                </Button>
              ))}
            </div>
            {error ? (
              <p
                role="alert"
                className="px-2 pb-2 text-xs text-destructive-foreground"
              >
                {t("common:modals.createTask.labelCreateError")}
              </p>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

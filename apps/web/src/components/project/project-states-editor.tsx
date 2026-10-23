import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { GripVertical, Plus } from "lucide-react";
import { type CSSProperties, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import useCreateProjectState from "@/hooks/mutations/project/use-create-project-state";
import useUpdateProjectState from "@/hooks/mutations/project/use-update-project-state";
import useGetProjectStateTemplates from "@/hooks/queries/project/use-get-project-state-templates";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import { useDndAccessibility } from "@/hooks/use-dnd-accessibility";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

const NONE = "none";

type StateFailure = "forbidden" | "noTransition" | "exists" | "generic";

function classifyStateFailure(
  status: number | undefined,
  message: string | undefined,
): StateFailure {
  if (status === 403) return "forbidden";
  if (status === 409) return "exists";
  if (status === 422 && message?.includes("PR-17")) return "noTransition";
  return "generic";
}

/** One state row. The grip is the drag handle: it is the keyboard and touch activator too. */
function SortableStateRow({
  id,
  canEdit,
  handleLabel,
  children,
}: {
  id: string;
  canEdit: boolean;
  handleLabel: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: !canEdit,
    // The reorder already moves the row; animating the index change too replays it.
    animateLayoutChanges: () => false,
    transition: { duration: 200, easing: "var(--ease-out)" },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-state-id={id}
      className={`flex items-center gap-2 p-2 border border-border rounded-md bg-sidebar hover:bg-sidebar-accent/50 transition-colors ${isDragging ? "opacity-60" : ""}`}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0 cursor-grab touch-none text-muted-foreground"
        aria-label={handleLabel}
        disabled={!canEdit}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </Button>
      {children}
    </li>
  );
}

/**
 * Project settings -> States (PR-17): the project's own concrete states, each mapped to a
 * workspace state template. Reorder with dnd-kit sortable, as the board and list do (mouse,
 * touch and keyboard), make one the default for new work items, and add a state from a template that has an
 * outbound workflow transition (WF-2). Needs the strict `project:manage_settings`; the server
 * decides and a 403 is handled. Archiving a state is not offered: its rule for states that
 * still hold work items is not specified yet.
 */
export default function ProjectStatesEditor({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canManageProjectSettings } = useWorkspacePermission();
  const canEdit = canManageProjectSettings();
  const {
    data: states,
    isLoading,
    isError,
    refetch,
  } = useGetProjectStates(projectId);
  const { data: templates } = useGetProjectStateTemplates(projectId, canEdit);
  const { mutateAsync: createState, isPending: isCreating } =
    useCreateProjectState();
  const { mutateAsync: updateState } = useUpdateProjectState();

  // The local drag order is only valid for the server list it was made from: a refetch
  // (`states` is a new array) discards it, so it can never outlive a server change.
  const [draftOrder, setDraftOrder] = useState<{
    ids: string[];
    base: unknown;
  } | null>(null);
  const [templateId, setTemplateId] = useState<string>(NONE);
  const [failure, setFailure] = useState<StateFailure | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 10 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const describeState = useCallback(
    (id: string | number) => states?.find((state) => state.id === id)?.name,
    [states],
  );
  const dndAccessibility = useDndAccessibility(describeState);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "states"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "state-templates"],
      }),
    ]);
  };

  const reportFailure = (error: unknown) => {
    const next =
      error instanceof HttpError
        ? classifyStateFailure(error.status, error.message)
        : "generic";
    setFailure(next);
    if (next === "forbidden") {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", workspaceId],
      });
    }
  };

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        className="space-y-2"
        data-testid="project-states-loading"
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError || !states) {
    return (
      <Alert variant="error" role="alert">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          {t("settings:projectStates.loadError")}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            {t("settings:projectGeneral.engagement.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const order = draftOrder?.base === states ? draftOrder.ids : null;
  const setOrder = (ids: string[] | null) =>
    setDraftOrder(ids ? { ids, base: states } : null);
  const byId = new Map(states.map((state) => [state.id, state]));
  const shown = (order ?? states.map((state) => state.id))
    .map((id) => byId.get(id))
    .filter((state): state is (typeof states)[number] => state !== undefined);

  const addable = (templates ?? []).filter((template) => !template.inUse);
  const templateItems = [
    { value: NONE, label: t("settings:projectStates.pickTemplate") },
    ...addable.map((template) => ({
      value: template.id,
      label: template.hasOutboundTransition
        ? template.name
        : t("settings:projectStates.templateNoTransition", {
            name: template.name,
          }),
    })),
  ];

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!canEdit || !over || active.id === over.id) return;
    const ids = shown.map((state) => state.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setOrder(arrayMove(ids, from, to));
    setFailure(null);
    try {
      await updateState({
        projectId,
        stateId: String(active.id),
        position: to,
      });
      await refresh();
    } catch (error) {
      setOrder(null);
      reportFailure(error);
    }
  };

  const handleDefault = async (stateId: string) => {
    setFailure(null);
    try {
      await updateState({ projectId, stateId, isDefault: true });
      await refresh();
      toast.success(t("settings:projectStates.defaultSaved"));
    } catch (error) {
      reportFailure(error);
    }
  };

  const handleCreate = async () => {
    if (templateId === NONE) return;
    setFailure(null);
    try {
      await createState({ projectId, stateTemplateId: templateId });
      setTemplateId(NONE);
      await refresh();
      toast.success(t("settings:projectStates.created"));
    } catch (error) {
      reportFailure(error);
    }
  };

  return (
    <div className="space-y-3" data-testid="project-states-editor">
      <DndContext
        accessibility={dndAccessibility}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={(event) => void handleDragEnd(event)}
      >
        <SortableContext
          items={shown.map((state) => state.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-1">
            {shown.map((state) => (
              <SortableStateRow
                key={state.id}
                id={state.id}
                canEdit={canEdit}
                handleLabel={t("settings:projectStates.reorder", {
                  name: state.name,
                })}
              >
                <span className="text-sm flex-1 truncate">{state.name}</span>
                <Badge variant="outline">
                  {t(`settings:projectStates.groups.${state.group}`)}
                </Badge>
                {state.isDefault ? (
                  <Badge variant="secondary">
                    {t("settings:projectStates.default")}
                  </Badge>
                ) : (
                  canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => void handleDefault(state.id)}
                    >
                      {t("settings:projectStates.makeDefault")}
                    </Button>
                  )
                )}
              </SortableStateRow>
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Select
            items={templateItems}
            value={templateId}
            disabled={isCreating || addable.length === 0}
            onValueChange={(value) =>
              setTemplateId(typeof value === "string" ? value : NONE)
            }
          >
            <SelectTrigger
              className="h-8 flex-1"
              aria-label={t("settings:projectStates.pickTemplate")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templateItems.map((item) => (
                <SelectItem
                  key={item.value}
                  value={item.value}
                  disabled={
                    item.value !== NONE &&
                    addable.find((template) => template.id === item.value)
                      ?.hasOutboundTransition === false
                  }
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={templateId === NONE || isCreating}
            onClick={() => void handleCreate()}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("settings:projectStates.add")}
          </Button>
        </div>
      )}

      {failure && (
        <Alert variant="error" role="alert">
          <AlertDescription>
            {t(`settings:projectStates.failure.${failure}`)}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

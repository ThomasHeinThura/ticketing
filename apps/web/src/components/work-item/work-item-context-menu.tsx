import { ContextMenu, ContextMenuTrigger } from "@taskdesk/ui";
import {
  cloneElement,
  type HTMLAttributes,
  lazy,
  type ReactElement,
  Suspense,
  useEffect,
  useState,
} from "react";
import type { WorkItemRow } from "@/types/work-item";

const CanonicalTaskMenu = lazy(
  () => import("./work-item-context-menu-content"),
);

/** Original Kaneo delegated context trigger over canonical row identities. */
export default function WorkItemContextMenu({
  items,
  children,
}: {
  items: WorkItemRow[];
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const [intent, setIntent] =
    useState<Pick<WorkItemRow, "key" | "workspaceId" | "projectId">>();
  const [open, setOpen] = useState(false);
  const [keyboardAnchor, setKeyboardAnchor] = useState<HTMLElement>();
  useEffect(() => {
    if (
      intent &&
      !items.some(
        (item) =>
          item.key === intent.key &&
          item.workspaceId === intent.workspaceId &&
          item.projectId === intent.projectId &&
          !item.unavailableFields.includes("key"),
      )
    ) {
      setOpen(false);
      setIntent(undefined);
      setKeyboardAnchor(undefined);
    }
  }, [items, intent]);
  function resolve(target: EventTarget | null) {
    if (!(target instanceof Element)) return undefined;
    const id = target.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
    const row = items.find((item) => item.id === id);
    return row && !row.unavailableFields.includes("key") ? row : undefined;
  }
  return (
    <ContextMenu
      open={open && !!intent}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setKeyboardAnchor(undefined);
      }}
    >
      <ContextMenuTrigger asChild>
        {cloneElement(children, {
          onContextMenuCapture: (event) => {
            setKeyboardAnchor(undefined);
            const row = resolve(event.target);
            if (!row) {
              event.preventDefault();
              setOpen(false);
              setIntent(undefined);
              return;
            }
            setIntent({
              key: row.key,
              workspaceId: row.workspaceId,
              projectId: row.projectId,
            });
          },
          onKeyDownCapture: (event) => {
            if (
              event.key !== "ContextMenu" &&
              !(event.shiftKey && event.key === "F10")
            )
              return;
            const row = resolve(event.target);
            if (!row) return;
            event.preventDefault();
            setIntent({
              key: row.key,
              workspaceId: row.workspaceId,
              projectId: row.projectId,
            });
            setKeyboardAnchor(
              event.target instanceof Element
                ? (event.target.closest<HTMLElement>("[data-task-id]") ??
                    undefined)
                : undefined,
            );
            setOpen(true);
          },
        })}
      </ContextMenuTrigger>
      {intent ? (
        <Suspense fallback={null}>
          <CanonicalTaskMenu
            key={`${intent.workspaceId}:${intent.projectId}:${intent.key}`}
            workspaceId={intent.workspaceId}
            projectId={intent.projectId}
            itemKey={intent.key}
            open={open}
            keyboardAnchor={keyboardAnchor}
            onClose={() => {
              setOpen(false);
              setKeyboardAnchor(undefined);
            }}
          />
        </Suspense>
      ) : null}
    </ContextMenu>
  );
}

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useBulkSelectionKeyboardShortcuts } from "@/hooks/use-bulk-selection-keyboard-shortcuts";

const WorkItemSelectionToggle = lazy(
  () => import("./work-item-selection-toggle"),
);
const BulkAssignToolbar = lazy(() => import("./bulk-assign-toolbar"));

const MAX_SELECTED = 500;

/**
 * `VW-3`: Calendar and Gantt take part in the same selection mode and bulk action bar as the
 * list and board. Selection mode is the list's own switch ("Select items"): while it is on, a
 * bar or row toggles instead of opening, and the shared `BulkAssignToolbar` acts on the keys.
 */
export function useScheduleSelection({
  projectId,
  allKeys,
  paneOpen,
}: {
  /** Selection belongs to one project; it is dropped when the project changes. */
  projectId: string;
  /** Every key the layout currently shows, for Select all. A key that leaves it is deselected. */
  allKeys: string[];
  /** The detail pane or a dialog owns the keyboard. */
  paneOpen: boolean;
}) {
  const { t } = useTranslation();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [canBulkAct, setCanBulkAct] = useState(false);
  const hasEntered = useRef(false);
  const inMode = canBulkAct && selectionMode;

  // The Gantt project selector swaps `projectId` without remounting, and a filter, a search, a
  // month change or another person's edit can take an item off screen. A bulk action must only
  // ever reach items the person can see in this project.
  const previousProjectId = useRef(projectId);
  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    setSelectionMode(false);
    setSelectedKeys([]);
  }, [projectId]);
  useEffect(() => {
    const visible = new Set(allKeys);
    setSelectedKeys((current) => {
      const kept = current.filter((key) => visible.has(key));
      return kept.length === current.length ? current : kept;
    });
  }, [allKeys]);

  const clear = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys([]);
  }, []);
  const toggleMode = useCallback(() => {
    hasEntered.current = true;
    setSelectionMode((on) => !on);
    setSelectedKeys([]);
  }, []);
  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : current.length >= MAX_SELECTED
          ? current
          : [...current, key],
    );
  }, []);
  const selectAll = useCallback(() => {
    setSelectionMode(true);
    setSelectedKeys(allKeys.slice(0, MAX_SELECTED));
  }, [allKeys]);

  useBulkSelectionKeyboardShortcuts(canBulkAct && !paneOpen, {
    selectAll,
    clearSelection: clear,
  });

  const announcement = inMode
    ? selectedKeys.length > 0
      ? t("workItems:bulk.selected", { count: selectedKeys.length })
      : t("workItems:bulk.modeOn")
    : hasEntered.current
      ? t("workItems:bulk.modeOff")
      : "";

  return {
    /** Selection controls are live: the capability is present and the mode is on. */
    active: inMode,
    selectionMode,
    selectedKeys,
    announcement,
    setCanBulkAct,
    toggleMode,
    toggleKey,
    clear,
    /** Drops keys the bulk action finished, keeping the ones that failed selected. */
    removeKeys: (succeeded: string[]) =>
      setSelectedKeys((current) =>
        current.filter((key) => !succeeded.includes(key)),
      ),
  };
}

export type ScheduleSelection = ReturnType<typeof useScheduleSelection>;

/** The "Select items" switch; renders nothing without a bulk capability. */
export function ScheduleSelectionToggle({
  workspaceId,
  projectId,
  selection,
}: {
  workspaceId: string;
  projectId: string;
  selection: ScheduleSelection;
}) {
  return (
    <Suspense fallback={null}>
      <WorkItemSelectionToggle
        workspaceId={workspaceId}
        projectId={projectId}
        selectionMode={selection.selectionMode}
        onToggle={selection.toggleMode}
        onCapabilityChange={selection.setCanBulkAct}
      />
    </Suspense>
  );
}

/** The shared bulk action bar and the polite selection announcement. */
export function ScheduleSelectionBar({
  workspaceId,
  projectId,
  selection,
}: {
  workspaceId: string;
  projectId: string;
  selection: ScheduleSelection;
}) {
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {selection.announcement}
      </p>
      {selection.selectedKeys.length > 0 && selection.active ? (
        <Suspense fallback={null}>
          <BulkAssignToolbar
            projectId={projectId}
            workspaceId={workspaceId}
            selectedKeys={selection.selectedKeys}
            onAssigned={selection.removeKeys}
            onClear={selection.clear}
          />
        </Suspense>
      ) : null}
    </>
  );
}

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemLightList, {
  canPreviewWorkItemList,
} from "./work-item-light-list";

const preference = vi.hoisted(() => ({
  collapsed: undefined as string[] | undefined,
}));

vi.mock("@/hooks/use-project-view-preference", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/use-project-view-preference")
  >()),
  useProjectViewPreference: () => ({
    value: preference.collapsed,
    set: vi.fn(),
    settled: true,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

function item(number: number, stateId: string): WorkItemRow {
  return {
    id: `id-${number}`,
    key: `WLP-${number}`,
    number,
    projectId: "project-1",
    workspaceId: "workspace-1",
    typeId: "type-1",
    requesterId: null,
    parentId: null,
    customerVisibility: "private",
    archivedAt: null,
    deletedAt: null,
    stateCategory: "started",
    title: `Title ${number}`,
    description: null,
    stateId,
    stateName: stateId,
    priority: "medium",
    assigneeId: number % 2 ? "person-1" : null,
    assigneeName: number % 2 ? "Ada Lovelace" : null,
    position: "1",
    startDate: null,
    dueDate: null,
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
    version: 1,
    unavailableFields: [],
  };
}

const states = [
  { id: "open", name: "Open", group: "started" },
  { id: "done", name: "Done", group: "completed" },
  { id: "empty", name: "Waiting", group: "unstarted" },
];

afterEach(() => {
  cleanup();
  preference.collapsed = undefined;
});

describe("WorkItemLightList", () => {
  it("paints each state's header and count with the first viewport's rows", () => {
    const workItems = [
      ...Array.from({ length: 200 }, (_, index) => item(index + 1, "open")),
      item(201, "done"),
    ];
    render(
      <WorkItemLightList
        projectId="project-1"
        workItems={workItems}
        states={states}
      />,
    );

    const preview = screen.getByTestId("work-item-list-preview");
    expect(preview).toHaveAttribute("aria-busy", "true");
    expect(within(preview).getByText("Open")).toBeInTheDocument();
    expect(within(preview).getByText("200")).toBeInTheDocument();
    expect(within(preview).getByText("Title 1")).toBeInTheDocument();
    expect(within(preview).getByText("WLP-1")).toBeInTheDocument();
    expect(within(preview).getAllByText("AL").length).toBeGreaterThan(0);
    // Only the first viewport is painted; the rest of the group is a spacer.
    expect(within(preview).queryByText("Title 200")).not.toBeInTheDocument();
    expect(within(preview).getByText("Waiting")).toBeInTheDocument();
    expect(within(preview).getByText("tasks:listView.noTasks")).toBeVisible();
  });

  it("formats a real due date and respects the hidden-date preference", () => {
    const showDueDates = useUserPreferencesStore.getState().showDueDates;
    const datedItem = {
      ...item(1, "open"),
      dueDate: new Date(2026, 0, 12, 12).toISOString(),
    };
    try {
      act(() => useUserPreferencesStore.setState({ showDueDates: true }));
      render(
        <WorkItemLightList
          projectId="project-1"
          workItems={[datedItem]}
          states={states}
        />,
      );
      expect(screen.getByText("Jan 12")).toBeVisible();
      act(() => useUserPreferencesStore.setState({ showDueDates: false }));
      expect(screen.queryByText("Jan 12")).not.toBeInTheDocument();
    } finally {
      act(() => useUserPreferencesStore.setState({ showDueDates }));
    }
  });

  it("carries none of the hydrated list's markers or controls", () => {
    render(
      <WorkItemLightList
        projectId="project-1"
        workItems={[item(1, "open")]}
        states={states}
      />,
    );

    expect(
      screen.queryByTestId("work-item-list-populated"),
    ).not.toBeInTheDocument();
    expect(document.querySelector("[data-task-id]")).toBeNull();
    expect(document.querySelector("[data-primary-content-ready]")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps a collapsed group's rows hidden", () => {
    preference.collapsed = ["open"];
    render(
      <WorkItemLightList
        projectId="project-1"
        workItems={[item(1, "open"), item(2, "done")]}
        states={states}
      />,
    );

    expect(screen.queryByText("Title 1")).not.toBeInTheDocument();
    expect(screen.getByText("Title 2")).toBeInTheDocument();
  });
});

describe("canPreviewWorkItemList", () => {
  const ready = { workItems: [item(1, "open")], states, sort: "key" };

  it("previews loaded rows that all sit in an active state", () => {
    expect(canPreviewWorkItemList(ready)).toBe(true);
  });

  it("leaves error-adjacent, empty and manually ranked lists to the list itself", () => {
    expect(canPreviewWorkItemList({ ...ready, workItems: [] })).toBe(false);
    expect(canPreviewWorkItemList({ ...ready, states: undefined })).toBe(false);
    expect(canPreviewWorkItemList({ ...ready, hasPartialFailure: true })).toBe(
      false,
    );
    expect(canPreviewWorkItemList({ ...ready, sort: "position" })).toBe(false);
    expect(
      canPreviewWorkItemList({
        ...ready,
        workItems: [item(1, "retired-state")],
      }),
    ).toBe(false);
    expect(
      canPreviewWorkItemList({
        ...ready,
        workItems: [{ ...item(1, "open"), deletedAt: "2026-10-22T00:00:00Z" }],
      }),
    ).toBe(false);
  });
});

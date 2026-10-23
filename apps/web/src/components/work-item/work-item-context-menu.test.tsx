import { Button, ContextMenuItem } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TaskContextMenuPresentation from "@/components/kanban-board/task-card-context-menu/task-context-menu-presentation";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemContextMenu from "./work-item-context-menu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const calls = vi.hoisted(() => vi.fn());
vi.mock("./work-item-context-menu-content", () => ({
  default: (props: {
    itemKey: string;
    workspaceId: string;
    projectId: string;
    keyboardAnchor?: HTMLElement;
  }) => {
    calls(props);
    return (
      <TaskContextMenuPresentation
        keyboardAnchor={props.keyboardAnchor}
        onCopyLink={() => {}}
        status={<ContextMenuItem>Actions for {props.itemKey}</ContextMenuItem>}
      />
    );
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
const rows = [
  {
    id: "canonical-id",
    key: "HELP-7",
    workspaceId: "workspace",
    projectId: "project",
    unavailableFields: [],
  },
] as unknown as WorkItemRow[];
function mount(items = rows) {
  return render(
    <WorkItemContextMenu items={items}>
      <div>
        <div data-task-id="canonical-id">
          <Button type="button">Real row</Button>
        </div>
        <Button type="button">Background</Button>
      </div>
    </WorkItemContextMenu>,
  );
}
it("delegates an actual row right-click to the scoped canonical controller", async () => {
  mount();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Real row" }));
  expect(
    await screen.findByRole("menuitem", { name: "Actions for HELP-7" }),
  ).toBeVisible();
  expect(calls).toHaveBeenLastCalledWith(
    expect.objectContaining({
      itemKey: "HELP-7",
      workspaceId: "workspace",
      projectId: "project",
    }),
  );
});
it.each([{ key: "F10", shiftKey: true }, { key: "ContextMenu" }])(
  "opens the same real menu with keyboard %j",
  async (keyboard) => {
    mount();
    const row = screen.getByRole("button", { name: "Real row" });
    row.focus();
    fireEvent.keyDown(row, keyboard);
    expect(
      await screen.findByRole("menuitem", { name: "Actions for HELP-7" }),
    ).toBeVisible();
  },
);
it("does not reopen an old item's menu from empty background", async () => {
  mount();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Real row" }));
  await screen.findByRole("menuitem", { name: "Actions for HELP-7" });
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.contextMenu(screen.getByRole("button", { name: "Background" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("menuitem", { name: "Actions for HELP-7" }),
    ).not.toBeInTheDocument(),
  );
});
it("never creates a menu for a malformed/unavailable key", async () => {
  mount([{ ...rows[0], unavailableFields: ["key"] }]);
  fireEvent.contextMenu(screen.getByRole("button", { name: "Real row" }));
  expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  expect(calls).not.toHaveBeenCalled();
});

it("closes a selected menu when its current loaded scope disappears", async () => {
  const view = mount();
  fireEvent.contextMenu(screen.getByRole("button", { name: "Real row" }));
  await screen.findByRole("menuitem", { name: "Actions for HELP-7" });
  view.rerender(
    <WorkItemContextMenu items={[]}>
      <div>
        <Button type="button">Background</Button>
      </div>
    </WorkItemContextMenu>,
  );
  await waitFor(() =>
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument(),
  );
});

it("anchors keyboard menus to the current row rect, follows scroll, and restores pointer positioning", async () => {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
    1024,
  );
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
    768,
  );
  mount();
  const button = screen.getByRole("button", { name: "Real row" });
  const row = button.closest<HTMLElement>("[data-task-id]");
  if (!row) throw new Error("Expected the real task row");
  let top = 180;
  const rect = vi
    .spyOn(row, "getBoundingClientRect")
    .mockImplementation(() =>
      DOMRect.fromRect({ x: 120, y: top, width: 240, height: 32 }),
    );
  button.focus();
  fireEvent.keyDown(button, { key: "F10", shiftKey: true });
  await screen.findByRole("menuitem", { name: "Actions for HELP-7" });
  expect(calls).toHaveBeenLastCalledWith(
    expect.objectContaining({ keyboardAnchor: row }),
  );
  await waitFor(() => expect(rect).toHaveBeenCalled());
  const positioner = document.querySelector<HTMLElement>(
    '[data-slot="context-menu-positioner"]',
  );
  if (!positioner) throw new Error("Expected the real ContextMenu positioner");
  await waitFor(() => expect(positioner.style.transform).toContain("120px"));
  expect(positioner.style.transform).toContain("214px");
  top = 100;
  fireEvent.scroll(window);
  await waitFor(() => expect(positioner.style.transform).toContain("134px"));
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.contextMenu(button, { clientX: 320, clientY: 260 });
  await waitFor(() =>
    expect(calls).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyboardAnchor: undefined }),
    ),
  );
  await waitFor(() =>
    expect(
      document.querySelector<HTMLElement>(
        '[data-slot="context-menu-positioner"]',
      )?.style.transform,
    ).toContain("320px"),
  );
});

import { ContextMenu, ContextMenuTrigger } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import TaskContextMenuPresentation from "./task-context-menu-presentation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (value: string) => translate(`tasks:priority.${value}`),
}));
afterEach(cleanup);
it("uses original actual context primitives, geometry, priority icons and submenu selection", async () => {
  const priority = vi.fn();
  render(
    <ContextMenu>
      <ContextMenuTrigger>Task</ContextMenuTrigger>
      <TaskContextMenuPresentation
        onCopyLink={vi.fn()}
        priority={{ value: "low", onChange: priority }}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("Task"));
  expect(screen.getByRole("menu")).toHaveClass("w-46");
  const submenu = screen.getByRole("menuitem", {
    name: translate("tasks:priority.label"),
  });
  fireEvent.click(submenu);
  const high = await screen.findByRole("menuitemcheckbox", { name: /high/i });
  expect(high.closest('[data-slot="context-menu-sub-content"]')).toHaveClass(
    "w-48",
  );
  expect(high.querySelector("svg")).not.toBeNull();
  fireEvent.click(high);
  expect(priority).toHaveBeenCalledExactlyOnceWith("high");
});
it("does not invent planned/archive-state aliases or unauthorized options", () => {
  render(
    <ContextMenu>
      <ContextMenuTrigger>Task</ContextMenuTrigger>
      <TaskContextMenuPresentation onCopyLink={vi.fn()} />
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("Task"));
  expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  expect(screen.getByRole("menuitem")).toHaveTextContent(
    translate("tasks:contextMenu.copyLink"),
  );
});

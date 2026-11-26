import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CycleBacklogPanel } from "./cycle-backlog-panel";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/work-item/use-get-board-work-items", () => ({
  default: () => ({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: {
      pages: [
        {
          items: [
            {
              id: "1",
              key: "WEB-1",
              title: "Read-only row",
              stateName: "Todo",
              stateCategory: "unstarted",
              unavailableFields: [],
              cycleId: null,
              moduleId: null,
            },
          ],
        },
      ],
    },
  }),
}));

afterEach(cleanup);

it("keeps the read-only backlog list keyboard-scrollable (axe scrollable-region-focusable)", () => {
  render(
    <CycleBacklogPanel
      project={{ id: "p1", slug: "web" }}
      workspaceId="w1"
      canAdd={false}
      onAdd={vi.fn()}
    />,
  );
  const list = screen.getByRole("list", { name: "backlog.title" });
  expect(list).toHaveAttribute("tabindex", "0");
  expect(screen.queryByRole("button")).toBeNull();
});

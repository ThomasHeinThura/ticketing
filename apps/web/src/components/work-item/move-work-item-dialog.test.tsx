import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import type { WorkItemDetailRow } from "@/types/work-item";
import MoveWorkItemDialog from "./move-work-item-dialog";

const mocks = vi.hoisted(() => ({ move: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/fetchers/work-item/move-work-item", () => ({
  default: (...args: unknown[]) => mocks.move(...args),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    isLoading: false,
    isError: false,
    data: [
      { id: "source", name: "Help desk", archivedAt: null },
      { id: "target", name: "Operations", archivedAt: null },
    ],
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const item = {
  key: "HELP-7",
  projectId: "source",
  workspaceId: "workspace",
  version: 4,
} as WorkItemDetailRow;

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MoveWorkItemDialog item={item} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.resetAllMocks());

describe("MoveWorkItemDialog", () => {
  it("states what happens to sub-items before confirming, and starts with moving them", () => {
    mount();
    expect(
      screen.getByText(translate("workItems:move.childrenMoveHelp")),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: translate("workItems:move.children"),
      }),
    );
    expect(
      screen.getByText(
        translate("workItems:move.childrenDetachHelp", {
          project: "Help desk",
        }),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(translate("workItems:move.consequences")),
    ).toBeTruthy();
  });

  it("cannot be confirmed until a target project is chosen", () => {
    mount();
    expect(
      screen.getByRole("button", { name: translate("workItems:move.confirm") }),
    ).toBeDisabled();
    expect(mocks.move).not.toHaveBeenCalled();
  });
});

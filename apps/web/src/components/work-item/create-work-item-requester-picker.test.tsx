import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateWorkItemRequesterPicker from "./create-work-item-requester-picker";

const mocks = vi.hoisted(() => ({
  requesters: [] as unknown[],
  enabled: [] as boolean[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/work-item/use-get-requester-candidates", () => ({
  default: ({ enabled }: { enabled: boolean }) => {
    mocks.enabled.push(enabled);
    return { data: mocks.requesters };
  },
}));

afterEach(() => {
  cleanup();
  mocks.requesters = [];
  mocks.enabled = [];
});

describe("CreateWorkItemRequesterPicker (A-03)", () => {
  it("is hidden when the project's organisation has no customers", () => {
    const { container } = render(
      <CreateWorkItemRequesterPicker
        projectId="p1"
        requesterId=""
        onChange={vi.fn()}
        canUpdate
        disabled={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not load customers without work_item:update", () => {
    mocks.requesters = [{ personId: "c1", name: "Alice", email: null }];
    const { container } = render(
      <CreateWorkItemRequesterPicker
        projectId="p1"
        requesterId=""
        onChange={vi.fn()}
        canUpdate={false}
        disabled={false}
      />,
    );
    expect(mocks.enabled).toEqual([false]);
    expect(container).toBeEmptyDOMElement();
  });

  it("picks a customer and clears the choice", () => {
    mocks.requesters = [
      { personId: "c1", name: "Alice", email: "alice@example.test" },
    ];
    const onChange = vi.fn();
    const { rerender } = render(
      <CreateWorkItemRequesterPicker
        projectId="p1"
        requesterId=""
        onChange={onChange}
        canUpdate
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByTestId("create-work-item-requester-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Alice" }));
    expect(onChange).toHaveBeenLastCalledWith("c1");
    rerender(
      <CreateWorkItemRequesterPicker
        projectId="p1"
        requesterId="c1"
        onChange={onChange}
        canUpdate
        disabled={false}
      />,
    );
    expect(
      screen.getByTestId("create-work-item-requester-trigger"),
    ).toHaveTextContent("Alice");
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:properties.noRequester" }),
    );
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

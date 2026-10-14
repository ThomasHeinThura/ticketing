import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import WorkItemSelectionToggle from "./work-item-selection-toggle";

const perms = vi.hoisted(() => ({
  assign: false,
  checking: false,
  update: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canAssignTasks: () => perms.assign,
    canUpdateTasks: () => perms.update,
    isCheckingPermissions: perms.checking,
  }),
}));

afterEach(() => {
  cleanup();
  perms.assign = false;
  perms.checking = false;
});

function mount(selectionMode = false) {
  const onToggle = vi.fn();
  const onCapabilityChange = vi.fn();
  const view = render(
    <WorkItemSelectionToggle
      selectionMode={selectionMode}
      onToggle={onToggle}
      onCapabilityChange={onCapabilityChange}
    />,
  );
  return { onToggle, onCapabilityChange, view };
}

describe("WorkItemSelectionToggle", () => {
  it("renders nothing and reports false without assignTasks (updateTasks is not enough)", () => {
    const { onCapabilityChange } = mount();
    expect(screen.queryByRole("button")).toBeNull();
    expect(onCapabilityChange).toHaveBeenLastCalledWith(false);
  });

  it("renders nothing and reports false while capabilities load", () => {
    perms.assign = true;
    perms.checking = true;
    const { onCapabilityChange } = mount();
    expect(screen.queryByRole("button")).toBeNull();
    expect(onCapabilityChange).toHaveBeenLastCalledWith(false);
  });

  it("with assignTasks renders a pressed-state toggle and reports true", () => {
    perms.assign = true;
    const { onToggle, onCapabilityChange } = mount(true);
    const button = screen.getByRole("button", { name: "Select items" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(onCapabilityChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("reports false again when it unmounts", () => {
    perms.assign = true;
    const { onCapabilityChange, view } = mount();
    view.unmount();
    expect(onCapabilityChange).toHaveBeenLastCalledWith(false);
  });
});

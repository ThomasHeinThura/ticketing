import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import WorkItemSelectionToggle from "./work-item-selection-toggle";

const perms = vi.hoisted(() => ({
  assign: false,
  checking: false,
  update: false,
  scope: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (...args: unknown[]) => {
    perms.scope(...args);
    return {
      canAssignTasks: () => perms.assign,
      canUpdateTasks: () => perms.update,
      isCheckingPermissions: perms.checking,
    };
  },
}));

afterEach(() => {
  cleanup();
  perms.assign = false;
  perms.checking = false;
  perms.update = false;
});

function mount(selectionMode = false) {
  const onToggle = vi.fn();
  const onCapabilityChange = vi.fn();
  const view = render(
    <WorkItemSelectionToggle
      workspaceId="ws"
      projectId="project"
      selectionMode={selectionMode}
      onToggle={onToggle}
      onCapabilityChange={onCapabilityChange}
    />,
  );
  return { onToggle, onCapabilityChange, view };
}

describe("WorkItemSelectionToggle", () => {
  it("renders nothing and reports false without any bulk capability", () => {
    const { onCapabilityChange } = mount();
    expect(screen.queryByRole("button")).toBeNull();
    expect(onCapabilityChange).toHaveBeenLastCalledWith(false);
  });

  it("allows update-only actors to select archive, label and date operations using target scope", () => {
    perms.update = true;
    const { onCapabilityChange } = mount();
    expect(
      screen.getByRole("button", { name: "Select items" }),
    ).toBeInTheDocument();
    expect(onCapabilityChange).toHaveBeenLastCalledWith(true);
    expect(perms.scope).toHaveBeenCalledWith("ws", "project");
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

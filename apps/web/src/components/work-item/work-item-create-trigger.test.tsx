import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: { canCreate: false, checking: false },
  scopes: [] as Array<[string, string]>,
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (workspaceId: string, projectId: string) => {
    mocks.scopes.push([workspaceId, projectId]);
    return {
      canCreateTasks: () => mocks.permission.canCreate,
      isCheckingPermissions: mocks.permission.checking,
    };
  },
}));

vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import WorkItemCreateTrigger from "./work-item-create-trigger";

describe("WorkItemCreateTrigger", () => {
  afterEach(() => {
    cleanup();
    mocks.permission = { canCreate: false, checking: false };
    mocks.scopes = [];
  });

  it("keeps the action hidden while permission is pending or denied", () => {
    mocks.permission = { canCreate: true, checking: true };
    const { rerender } = render(
      <WorkItemCreateTrigger
        workspaceId="workspace-target"
        projectId="project-target"
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("create-work-item-trigger")).toBeNull();
    // Its footprint is held, hidden and inert, so the toolbar does not shift (G13).
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("button")).toHaveClass("invisible");
    expect(document.querySelector("button")).toBeDisabled();

    mocks.permission = { canCreate: false, checking: false };
    rerender(
      <WorkItemCreateTrigger
        workspaceId="workspace-target"
        projectId="project-target"
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("create-work-item-trigger")).toBeNull();
    expect(document.querySelector("button")).toBeNull();
  });

  it("preserves the permitted create action", () => {
    mocks.permission = { canCreate: true, checking: false };
    const onClick = vi.fn();
    render(
      <WorkItemCreateTrigger
        workspaceId="workspace-target"
        projectId="project-target"
        onClick={onClick}
      />,
    );

    const trigger = screen.getByTestId("create-work-item-trigger");
    expect(trigger).toHaveTextContent("workItems:create.trigger");
    fireEvent.click(trigger);

    expect(onClick).toHaveBeenCalledOnce();
    expect(mocks.scopes).toContainEqual(["workspace-target", "project-target"]);
  });

  it("shows pending feedback while the dialog code loads", () => {
    mocks.permission = { canCreate: true, checking: false };
    const onClick = vi.fn();
    render(
      <WorkItemCreateTrigger
        workspaceId="workspace-target"
        projectId="project-target"
        onClick={onClick}
        pending
      />,
    );

    const trigger = screen.getByTestId("create-work-item-trigger");
    expect(trigger).toHaveAttribute("aria-busy", "true");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(onClick).not.toHaveBeenCalled();
  });
});

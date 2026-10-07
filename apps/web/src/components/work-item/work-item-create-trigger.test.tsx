import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: { canCreate: false, checking: false },
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: () => mocks.permission.canCreate,
    isCheckingPermissions: mocks.permission.checking,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import WorkItemCreateTrigger from "./work-item-create-trigger";

describe("WorkItemCreateTrigger", () => {
  afterEach(() => {
    mocks.permission = { canCreate: false, checking: false };
  });

  it("keeps the action hidden while permission is pending or denied", () => {
    mocks.permission = { canCreate: true, checking: true };
    const { rerender } = render(<WorkItemCreateTrigger onClick={vi.fn()} />);
    expect(screen.queryByTestId("create-work-item-trigger")).toBeNull();

    mocks.permission = { canCreate: false, checking: false };
    rerender(<WorkItemCreateTrigger onClick={vi.fn()} />);
    expect(screen.queryByTestId("create-work-item-trigger")).toBeNull();
  });

  it("keeps the permitted create action available", () => {
    mocks.permission = { canCreate: true, checking: false };
    const onClick = vi.fn();
    render(<WorkItemCreateTrigger onClick={onClick} />);

    const trigger = screen.getByTestId("create-work-item-trigger");
    expect(trigger).toHaveTextContent("workItems:create.trigger");
    fireEvent.click(trigger);

    expect(onClick).toHaveBeenCalledOnce();
  });
});

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
    const { rerender } = render(
      <WorkItemCreateTrigger onPreload={vi.fn()} onClick={vi.fn()} />,
    );
    expect(screen.queryByTestId("create-work-item-trigger")).toBeNull();

    mocks.permission = { canCreate: false, checking: false };
    rerender(<WorkItemCreateTrigger onPreload={vi.fn()} onClick={vi.fn()} />);
    expect(screen.queryByTestId("create-work-item-trigger")).toBeNull();
  });

  it("preserves the permitted create and intent-preload actions", () => {
    mocks.permission = { canCreate: true, checking: false };
    const onPreload = vi.fn();
    const onClick = vi.fn();
    render(<WorkItemCreateTrigger onPreload={onPreload} onClick={onClick} />);

    const trigger = screen.getByTestId("create-work-item-trigger");
    expect(trigger).toHaveTextContent("workItems:create.trigger");
    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);
    fireEvent.click(trigger);

    expect(onPreload).toHaveBeenCalledTimes(2);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

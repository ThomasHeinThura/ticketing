import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stable query results: the page resets its form whenever the workspace object changes.
const stable = vi.hoisted(() => ({
  workspace: {
    data: {
      id: "ws-1",
      name: "Primary SIT Service Desk",
      description: "Primary SIT Service Desk & Delivery Workspace for the team",
    },
  },
  full: { data: { members: [] } },
  stepUp: {},
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/god-mode/step-up-fields", () => ({
  FailureAlert: () => null,
  StepUpFields: () => null,
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u-1" } }),
}));
vi.mock("@/components/settings/workspace-project-defaults-panel", () => ({
  WorkspaceProjectDefaultsPanel: () => null,
}));
vi.mock("@/hooks/mutations/workspace/use-delete-workspace", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/workspace/use-transfer-workspace-ownership", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/workspace/use-update-workspace", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => stable.workspace,
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: () => stable.full,
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/hooks/use-step-up-action", () => ({
  useStepUpAction: () => stable.stepUp,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspace: () => true,
    canDeleteWorkspace: () => false,
    isOwner: false,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { Route } from "./general";

const Page = (Route as unknown as { component: ComponentType }).component;

afterEach(() => cleanup());

describe("workspace general settings (S10)", () => {
  it("edits the description in a multi-line field stacked under its label", () => {
    render(<Page />);
    const description = screen.getByLabelText(
      "settings:workspaceGeneral.descriptionLabel",
    );
    expect(description.tagName).toBe("TEXTAREA");
    expect(description).toHaveValue(
      "Primary SIT Service Desk & Delivery Workspace for the team",
    );
  });

  it("gives the name field room for a long workspace name on wider screens", () => {
    render(<Page />);
    const name = screen.getByLabelText("settings:workspaceGeneral.nameLabel");
    // The Input wrapper carries the width classes.
    expect(name.closest('[class*="md:w-80"]')).not.toBeNull();
  });
});

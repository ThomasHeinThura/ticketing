import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fakeQuery = vi.hoisted(() => ({
  data: {
    rows: [
      {
        id: "audit-1",
        seq: "1",
        createdAt: "2026-10-21T12:00:00.000Z",
        actorId: "user-1",
        actorType: "user",
        impersonatorId: null,
        workspaceId: "ws-1",
        organisationId: null,
        action: "workspace.role.create",
        entityType: "workspace_role",
        entityId: "role-1",
        before: null,
        after: null,
      },
    ],
  },
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}));

let fakeIsAdmin = true;

vi.mock("@/hooks/queries/god-mode/use-instance-audit", () => ({
  useInstanceAudit: () => fakeQuery,
}));

vi.mock("@/hooks/use-instance-admin-signal", () => ({
  useInstanceAdminSignal: () => fakeIsAdmin,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) =>
    config.component,
  useLocation: () => ({ pathname: "/agent/god-mode/audit", searchStr: "" }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Outlet: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue || key,
  }),
}));

vi.mock("@/components/page-title", () => ({
  default: () => null,
}));

import { Route } from "./audit";

describe("GodModeAuditRoute", () => {
  afterEach(cleanup);

  it("renders audit rows when caller is an instance administrator", () => {
    fakeIsAdmin = true;
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(screen.getByRole("heading", { name: "Audit log" })).toBeTruthy();
    expect(screen.getByText("workspace.role.create")).toBeTruthy();
    expect(screen.getByText("workspace_role")).toBeTruthy();
  });

  it("shows access denied when caller is not an instance administrator", () => {
    fakeIsAdmin = false;
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("list.deniedTitle")).toBeTruthy();
  });
});

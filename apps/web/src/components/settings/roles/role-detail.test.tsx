import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({ roleError: null as unknown }));

vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-caller-role-authority", () => ({
  useCallerRoleAuthority: () => ({}),
}));
vi.mock("@/hooks/queries/workspace-roles/use-role-queries", () => ({
  roleDetailKey: () => ["role"],
  useRole: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    error: mocks.roleError,
    refetch: vi.fn(),
  }),
}));

import { RoleDetailView } from "./role-detail";

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RoleDetailView roleId="bogus" search={{}} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.roleError = null;
});

describe("RoleDetailView unknown role", () => {
  it("shows not-found without Retry when the role id does not exist (404)", () => {
    mocks.roleError = new HttpError(404, 'Workspace has no role named "bogus"');
    setup();
    expect(screen.getByTestId("role-not-found")).toHaveTextContent(
      translate("roles:detail.notFoundDescription"),
    );
    expect(
      screen.queryByRole("button", { name: translate("common:actions.retry") }),
    ).not.toBeInTheDocument();
  });

  it("keeps Retry for other load failures", () => {
    mocks.roleError = new HttpError(500, "boom");
    setup();
    expect(
      screen.getByRole("button", { name: translate("common:actions.retry") }),
    ).toBeInTheDocument();
  });
});

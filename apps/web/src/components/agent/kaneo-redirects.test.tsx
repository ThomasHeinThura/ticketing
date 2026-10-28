import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSearchRedirect } from "./kaneo-redirects";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Navigate: (props: Record<string, unknown>) => {
    mocks.navigate(props);
    return null;
  },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [], isLoading: false }),
}));

describe("WorkspaceSearchRedirect (P1R1-1)", () => {
  it("carries q and scope from /agent/search to the canonical search page", () => {
    render(
      <WorkspaceSearchRedirect
        search={{ q: "HELP-24", scope: "work-items" }}
      />,
    );
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/dashboard/workspace/$workspaceId/search",
        params: { workspaceId: "w1" },
        search: { q: "HELP-24", scope: "work-items" },
        replace: true,
      }),
    );
  });
});

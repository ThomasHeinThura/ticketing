import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import useProjectByKey from "./use-project-by-key";

const state = vi.hoisted(() => ({
  projects: [{ slug: "BB", workspaceId: "w1" }] as Array<{
    slug: string;
    workspaceId: string;
  }>,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: state.projects, isLoading: false }),
}));
vi.mock("@/fetchers/project/resolve-project-key", () => ({
  default: vi.fn(async () => "BB"),
}));

describe("useProjectByKey", () => {
  it("drops a cached resolved key once the old key is live again (rename back)", async () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useProjectByKey("AA"), { wrapper });
    await waitFor(() => expect(hook.result.current.currentKey).toBe("BB"));
    state.projects = [{ slug: "AA", workspaceId: "w1" }];
    hook.rerender();
    expect(hook.result.current.project?.slug).toBe("AA");
    expect(hook.result.current.currentKey).toBeUndefined();
  });
});

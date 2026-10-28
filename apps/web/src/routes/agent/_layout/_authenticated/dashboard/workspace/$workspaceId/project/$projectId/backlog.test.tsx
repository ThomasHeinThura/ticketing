import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./backlog";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ workspaceId: "w", projectId: "p" }),
  }),
}));
vi.mock("@/components/common/legacy-project-view", () => ({
  default: ({
    projectId,
    workspaceId,
    view,
  }: {
    projectId: string;
    workspaceId: string;
    view: string;
  }) => <div>{`${workspaceId}/${projectId}/${view}`}</div>,
}));

afterEach(cleanup);
describe("legacy backlog entry point", () => {
  it("delegates its real project and workspace IDs to the authorized compatibility adapter", () => {
    const Component = (Route as unknown as { component: ComponentType })
      .component;
    render(<Component />);
    expect(screen.getByText("w/p/backlog")).toBeTruthy();
  });
  it("retains the original controls for explicit compatibility handling", () => {
    const parse = (
      Route as unknown as { validateSearch: (raw: unknown) => unknown }
    ).validateSearch;
    expect(
      parse({
        q: "123",
        status: ["active"],
        sort: "createdAt",
        taskId: "HELP-4",
        filter: "state:started",
      }),
    ).toMatchObject({
      q: "123",
      status: ["active"],
      sort: "createdAt",
      taskId: "HELP-4",
      item: "HELP-4",
      filter: "state:started",
    });
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  useRemoveProjectMember,
  useUpdateProjectMemberRole,
} from "./use-project-member-mutations";

const mocks = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn() }));
vi.mock("@/fetchers/project-member/project-members", () => ({
  addProjectMember: vi.fn(),
  removeProjectMember: mocks.remove,
  updateProjectMemberRole: mocks.update,
}));

const target = (id: string) => ({
  kind: "entity",
  type: "project_membership",
  id,
  scope: { kind: "project", workspaceId: "w", projectId: "p" },
});

function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const audits = () =>
    client.getMutationCache().getAll().at(-1)?.options.meta?.audits;
  return { wrapper, audits };
}

it("targets the existing row and the direct row the answered roster shows, and never sends the row id", async () => {
  const { wrapper, audits } = setup();
  const roster = {
    members: [
      { personId: "person", membershipId: "child-row", source: "direct" },
    ],
  };
  mocks.update.mockResolvedValue(roster);
  const { result } = renderHook(() => useUpdateProjectMemberRole(), {
    wrapper,
  });
  const variables = {
    workspaceId: "w",
    projectId: "p",
    personId: "person",
    membershipId: null,
    roleKey: "lead",
  };
  await act(() => result.current.mutateAsync(variables));
  expect(mocks.update).toHaveBeenCalledWith({
    projectId: "p",
    personId: "person",
    roleKey: "lead",
  });
  expect(audits()?.targets(variables as never, roster as never)).toEqual([
    target("child-row"),
  ]);
});

it("targets the removed row from the variables because the answered roster no longer has it", async () => {
  const { wrapper, audits } = setup();
  mocks.remove.mockResolvedValue({ members: [] });
  const { result } = renderHook(() => useRemoveProjectMember(), { wrapper });
  const variables = {
    workspaceId: "w",
    projectId: "p",
    personId: "person",
    membershipId: "row",
  };
  await act(() => result.current.mutateAsync(variables));
  expect(mocks.remove).toHaveBeenCalledWith({
    projectId: "p",
    personId: "person",
  });
  expect(
    audits()?.targets(variables as never, { members: [] } as never),
  ).toEqual([target("row")]);
});

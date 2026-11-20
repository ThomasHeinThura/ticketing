import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  historyStamp,
  historyTargetHash,
  withdrawAuditedHistory,
} from "@/query-client/settings-history-key";
import useCreateProjectState from "./use-create-project-state";
import useUpdateProjectState from "./use-update-project-state";

const requests = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/fetchers/project/create-project-state", () => ({
  default: requests.create,
}));
vi.mock("@/fetchers/project/update-project-state", () => ({
  default: requests.update,
}));

it.each(["create", "update"] as const)(
  "withdraws project History when delayed %s completes",
  async (kind) => {
    let finish!: (value: unknown) => void;
    requests[kind].mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const client = new QueryClient({
      mutationCache: new MutationCache({
        onSuccess: (data, variables, _context, mutation) =>
          withdrawAuditedHistory(client, mutation.meta, variables, data),
      }),
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({
        create: useCreateProjectState(),
        update: useUpdateProjectState(),
      }),
      { wrapper },
    );
    const target = {
      kind: "entity",
      type: "project",
      id: "p1",
      scope: { kind: "project", workspaceId: "w1", projectId: "p1" },
    };
    const hash = historyTargetHash(target);
    let promise!: Promise<unknown>;
    act(() => {
      promise =
        kind === "create"
          ? result.current.create.mutateAsync({
              workspaceId: "w1",
              projectId: "p1",
              stateTemplateId: "s1",
            })
          : result.current.update.mutateAsync({
              workspaceId: "w1",
              projectId: "p1",
              stateId: "s1",
              isDefault: true,
            });
    });
    const before = historyStamp(hash);
    await act(async () => {
      finish([]);
      await promise;
    });
    expect(historyStamp(hash)).not.toBe(before);
  },
);

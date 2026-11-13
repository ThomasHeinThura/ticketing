import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemDetail, WorkItemDetailRow } from "@/types/work-item";
import {
  applyOptimisticWorkItemFields,
  mergeAuthoritativeWorkItemRead,
  mergeWorkItemListPage,
  type OptimisticWorkItemSnapshot,
  rollbackOptimisticWorkItemFields,
  settleWorkItemMutation,
  workItemDetailKey,
  workItemMutationKey,
  workItemMutationScope,
  writeWorkItemResponse,
} from "./work-item-save";

// A tiny fixed-seed generator: no timers or external property-testing dependency.
function generator(seed: number) {
  let value = seed >>> 0;
  return (limit: number) => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value % limit;
  };
}
const seeds = [1, 7, 23, 42, 101, 509];

type Write = {
  fields: Partial<WorkItemDetail>;
  snapshot?: OptimisticWorkItemSnapshot;
};

it("preserves item, read, refusal, projection and queue invariants across 300 seeded interleavings", async () => {
  for (const seed of seeds) {
    for (let sequence = 0; sequence < 50; sequence++) {
      const random = generator(seed * 1000 + sequence);
      const client = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { retry: false },
        },
      });
      const detailKey = workItemDetailKey("HELP-7");
      const listKey = ["work-items", "p1", "search", "a"];
      const otherListKey = ["work-items", "p1", "search", "b"];
      let truth = {
        key: "HELP-7",
        projectId: "p1",
        workspaceId: "w1",
        version: 4,
        stateId: "initial",
        stateName: "Initial",
        stateCategory: "unstarted",
        assigneeId: null,
        assigneeName: null,
        assigneeActive: null,
        assigneeOnProject: null,
      } as unknown as WorkItemDetailRow;
      const other = {
        ...truth,
        key: "HELP-8",
        title: "Must stay untouched",
        version: 91,
      };
      const page = (row: WorkItemDetailRow, projection: string) =>
        ({
          items: [
            { ...row, customFieldValues: { [projection]: projection } },
            other,
          ],
          hasMore: false,
          hasPartialFailure: false,
        }) as unknown as WorkItemsResult;
      client.setQueryData(detailKey, truth);
      client.setQueryData(workItemDetailKey(other.key), other);
      client.setQueryData(listKey, { pages: [page(truth, "a")] });
      client.setQueryData(otherListKey, { pages: [page(truth, "b")] });
      const running: Array<{
        input: Write;
        resolve: (value: boolean) => void;
      }> = [];
      const trace: unknown[] = [];
      let active = 0;
      let maxActive = 0;
      let repairs = 0;
      const mounted = renderHook(
        () =>
          useMutation({
            mutationKey: workItemMutationKey(truth.key),
            scope: workItemMutationScope(truth.key),
            onMutate: (input: Write) => {
              input.snapshot = applyOptimisticWorkItemFields(
                client,
                truth,
                input.fields,
              );
              return input.snapshot;
            },
            mutationFn: async (input: Write) => {
              trace.push(["start", input.fields, input.snapshot?.previous]);
              active++;
              maxActive = Math.max(maxActive, active);
              const succeeds = await new Promise<boolean>((resolve) =>
                running.push({ input, resolve }),
              );
              trace.push([
                "outcome",
                succeeds,
                input.fields,
                input.snapshot?.previous,
              ]);
              active--;
              if (!succeeds) throw new Error("refused");
              truth = { ...truth, ...input.fields, version: truth.version + 1 };
              writeWorkItemResponse(
                client,
                truth.key,
                truth,
                input.fields,
                input.fields,
                input.snapshot,
              );
            },
            onError: (_error, _input, snapshot) => {
              if (snapshot)
                rollbackOptimisticWorkItemFields(client, truth, snapshot);
            },
            onSettled: () =>
              settleWorkItemMutation(client, truth.key, () => {
                repairs++;
                // Failed settlement reads must leave cached server evidence intact.
                return client
                  .fetchQuery({
                    queryKey: ["repair", truth.key],
                    queryFn: async () => {
                      throw new Error("offline");
                    },
                  })
                  .catch(() => undefined);
              }),
          }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>
              {children}
            </QueryClientProvider>
          ),
        },
      );
      const mutate = mounted.result.current.mutate;
      const flush = async (fn: () => void) => {
        await act(async () => {
          fn();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      };
      const receive = (row: WorkItemDetailRow, list: boolean) => {
        const snapshots = client
          .getMutationCache()
          .findAll({ status: "pending" })
          .map((m) => m.state.context as OptimisticWorkItemSnapshot | undefined)
          .filter((s): s is OptimisticWorkItemSnapshot => Boolean(s));
        const expected = snapshots.map((s) => ({ ...s.expected }));
        if (list && client.isMutating()) {
          const merged = mergeWorkItemListPage(client, listKey, page(row, "a"));
          client.setQueryData(listKey, { pages: [merged] });
        } else mergeAuthoritativeWorkItemRead(client, truth.key, row);
        snapshots.forEach((s, i) => {
          expect(s.expected).toEqual(expected[i]);
        });
      };
      for (let step = 0; step < 30; step++) {
        await flush(() => {
          const event = random(10);
          trace.push([step, event, truth.version]);
          switch (event) {
            case 0: {
              const state = `choice-${random(3)}`;
              mutate({
                fields: {
                  stateId: state,
                  stateName: state,
                  stateCategory: "started",
                },
              });
              break;
            }
            case 1: {
              const person = random(3) ? `person-${random(3)}` : null;
              mutate({
                fields: {
                  assigneeId: person,
                  assigneeName: person,
                  assigneeActive: person ? true : null,
                  assigneeOnProject: person ? true : null,
                },
              });
              break;
            }
            case 2:
              truth = {
                ...truth,
                version: truth.version + 1,
                stateId: `server-${step}`,
                stateName: `Server ${step}`,
                stateCategory: "completed",
                assigneeId: `server-person-${step}`,
                assigneeName: `Server person ${step}`,
                assigneeActive: true,
                assigneeOnProject: true,
              };
              receive(truth, Boolean(random(2)));
              break;
            case 3:
              receive(
                {
                  ...truth,
                  version: truth.version - 1,
                  stateId: "stale",
                  stateName: "Stale",
                  assigneeId: "stale",
                },
                Boolean(random(2)),
              );
              break;
            case 4:
              running.shift()?.resolve(true);
              break;
            case 5:
              running.shift()?.resolve(false);
              break;
            case 6:
              client.setQueryData(listKey, { pages: [{ items: [other] }] });
              break;
            case 7:
              receive(truth, true);
              break;
            case 9:
              mergeAuthoritativeWorkItemRead(client, truth.key, {
                ...other,
                version: truth.version + 100,
              });
              break;
            case 8:
              // Switching/unmounting the screen cannot cancel mutation-level cleanup.
              if (step > 20) mounted.unmount();
              break;
          }
        });
      }
      // Drain with a mixture of success and refusal; final refusal must leave no ghost.
      while (client.isMutating())
        await flush(() => running.shift()?.resolve(Boolean(random(2))));
      expect(maxActive).toBeLessThanOrEqual(1);
      expect(active).toBe(0);
      const fields = [
        "stateId",
        "stateName",
        "stateCategory",
        "assigneeId",
        "assigneeName",
        "assigneeActive",
        "assigneeOnProject",
        "version",
      ] as const;
      for (const field of fields)
        expect(
          client.getQueryData<WorkItemDetailRow>(detailKey)?.[field],
          `seed ${seed}, sequence ${sequence}, detail ${field}`,
        ).toEqual(truth[field]);
      for (const [key, projection] of [
        [listKey, "a"],
        [otherListKey, "b"],
      ] as const) {
        const data = client.getQueryData<{
          pages: Array<{ items: Array<Record<string, unknown>> }>;
        }>(key);
        const row = data?.pages[0].items.find((r) => r.key === truth.key);
        if (row) {
          for (const field of fields)
            expect(
              row[field],
              `seed ${seed}, sequence ${sequence}, list ${projection} ${field} ${JSON.stringify(trace)}`,
            ).toEqual(truth[field]);
          expect(row.customFieldValues).toEqual({ [projection]: projection });
        }
        expect(data?.pages[0].items.find((r) => r.key === other.key)).toEqual(
          other,
        );
      }
      expect(client.getQueryData(workItemDetailKey(other.key))).toEqual(other);
      if (maxActive) expect(repairs).toBeGreaterThan(0);
      mounted.unmount();
      client.clear();
    }
  }
}, 60_000);

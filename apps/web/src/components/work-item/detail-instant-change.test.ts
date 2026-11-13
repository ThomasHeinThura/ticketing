import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import type { WorkItemDetailRow } from "@/types/work-item";
import {
  detailChangeErrorKey,
  startDetailAssigneeChange,
  startDetailStateChange,
} from "./detail-instant-change";

const api = vi.hoisted(() => ({
  state: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: api.state,
}));
vi.mock("@/fetchers/work-item/assign-work-item", () => ({
  default: api.assign,
}));
vi.mock("@/fetchers/work-item/unassign-work-item", () => ({
  default: api.unassign,
}));

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const row = (fields = {}) =>
  ({
    key: "HELP-7",
    projectId: "p1",
    workspaceId: "w1",
    stateId: "todo",
    stateName: "To do",
    stateCategory: "unstarted",
    assigneeId: "riley",
    assigneeName: "Riley",
    assigneeActive: true,
    assigneeOnProject: true,
    version: 4,
    title: "Original title",
    unavailableFields: [],
    ...fields,
  }) as unknown as WorkItemDetailRow;
const detailKey = ["work-items", "detail", "HELP-7"];
const listKey = ["work-items", "p1", "key", "asc"];
const choice = {
  stateId: "done",
  toStateTemplateId: "tpl-done",
  toStateName: "Done",
  toStateCategory: "completed" as const,
};
const person = { personId: "casey", name: "Casey" };
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(detailKey, row());
  client.setQueryData(listKey, {
    pages: [
      {
        items: [
          row({
            stateId: "review",
            stateName: "Review",
            version: 6,
            customFieldValues: { x: 1 },
          }),
        ],
        hasMore: false,
      },
    ],
    pageParams: [undefined],
  });
  const onSuccess = vi.fn();
  const onError = vi.fn();
  function required<T>(value: T | undefined): T {
    if (value === undefined) throw new Error("Missing test cache");
    return value;
  }
  return {
    client,
    feedback: { onSuccess, onError },
    detail: () => required(client.getQueryData<WorkItemDetailRow>(detailKey)),
    list: () =>
      required(
        client.getQueryData<{ pages: { items: WorkItemDetailRow[] }[] }>(
          listKey,
        ),
      ).pages[0].items[0],
  };
}
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

describe("detail single-write production helper", () => {
  it("shows state and category in detail and loaded list rows, without changing version or projections; applies every response field", async () => {
    const s = setup();
    const held = deferred();
    api.state.mockReturnValue(held.promise);
    const other = { items: [row({ key: "HELP-8" })] };
    const otherKey = ["work-items", "p1", "other"];
    s.client.setQueryData(otherKey, other);
    const untouched = s.client.getQueryData(otherKey);
    const otherUpdated = s.client.getQueryState(otherKey)?.dataUpdatedAt;
    const pending = startDetailStateChange(
      s.client,
      s.detail(),
      choice,
      s.feedback,
    );
    await tick();
    expect(s.detail()).toMatchObject({
      stateId: "done",
      stateCategory: "completed",
      version: 4,
      title: "Original title",
    });
    expect(s.list()).toMatchObject({
      stateName: "Done",
      version: 6,
      customFieldValues: { x: 1 },
    });
    expect(s.client.getQueryData(otherKey)).toBe(untouched);
    expect(s.client.getQueryState(otherKey)?.dataUpdatedAt).toBe(otherUpdated);
    held.resolve({
      stateId: "done",
      assigneeId: null,
      resolvedAt: "now",
      version: 7,
    });
    await pending;
    expect(s.detail()).toMatchObject({
      assigneeId: null,
      resolvedAt: "now",
      version: 7,
    });
    expect(s.client.getQueryState(otherKey)?.isInvalidated).toBe(true);
    expect(s.feedback.onSuccess).toHaveBeenCalledOnce();
    s.client.clear();
  });

  it.each([403, 409, 422, "network"])(
    "refusal %s restores each cache's own fields, reports the real message key, and invalidates the full prefix",
    async (status) => {
      const s = setup();
      const held = deferred();
      api.state.mockReturnValue(held.promise);
      const failure =
        typeof status === "number"
          ? new HttpError(status, "refused")
          : new Error("offline");
      const pending = startDetailStateChange(
        s.client,
        s.detail(),
        choice,
        s.feedback,
      );
      await tick();
      held.reject(failure);
      await pending;
      expect(s.detail()).toMatchObject({
        stateId: "todo",
        stateName: "To do",
        version: 4,
      });
      expect(s.list()).toMatchObject({
        stateId: "review",
        stateName: "Review",
        version: 6,
      });
      expect(s.feedback.onError).toHaveBeenCalledWith(failure);
      expect(detailChangeErrorKey(failure, "state")).toBe(
        `workItems:journey.${status === 403 ? "transitionForbidden" : status === 409 ? "transitionConflict" : status === 422 ? "transitionUnavailable" : "saveError"}`,
      );
      expect(s.client.getQueryState(detailKey)?.isInvalidated).toBe(true);
      expect(s.client.getQueryState(listKey)?.isInvalidated).toBe(true);
      s.client.clear();
    },
  );

  it("assigns and unassigns using exactly the holder at choice time; blocks BOTH choices while pending", async () => {
    const s = setup();
    const held = deferred();
    api.assign.mockReturnValue(held.promise);
    const pending = startDetailAssigneeChange(
      s.client,
      s.detail(),
      person,
      "riley",
      s.feedback,
    );
    expect(
      startDetailStateChange(s.client, s.detail(), choice, s.feedback),
    ).toBeUndefined();
    expect(
      startDetailAssigneeChange(
        s.client,
        s.detail(),
        null,
        "riley",
        s.feedback,
      ),
    ).toBeUndefined();
    await tick();
    expect(s.detail()).toMatchObject({
      assigneeId: "casey",
      assigneeName: "Casey",
    });
    expect(s.list()).toMatchObject({
      assigneeId: "casey",
      assigneeName: "Casey",
    });
    expect(api.assign).toHaveBeenCalledExactlyOnceWith({
      key: "HELP-7",
      assigneeId: "casey",
      expectedCurrentAssigneeId: "riley",
    });
    held.resolve({ assigneeId: "casey", version: 7 });
    await pending;
    api.unassign.mockResolvedValue({ assigneeId: null, version: 8 });
    await startDetailAssigneeChange(
      s.client,
      s.detail(),
      null,
      "casey",
      s.feedback,
    );
    expect(api.unassign).toHaveBeenCalledExactlyOnceWith("HELP-7", "casey");
    expect(s.detail().assigneeId).toBeNull();
    expect(
      startDetailAssigneeChange(s.client, s.detail(), null, null, s.feedback),
    ).toBeUndefined();
    expect(api.unassign).toHaveBeenCalledTimes(1);
    s.client.clear();
  });

  it("a changed-holder 409 never rewrites the ORIGINAL request precondition", async () => {
    const s = setup();
    const held = deferred();
    api.assign.mockReturnValue(held.promise);
    const pending = startDetailAssigneeChange(
      s.client,
      s.detail(),
      person,
      "riley",
      s.feedback,
    );
    await tick();
    s.client.setQueryData(
      detailKey,
      row({ assigneeId: "sam", assigneeName: "Sam", version: 5 }),
    );
    held.reject(new HttpError(409, "holder changed"));
    await pending;
    expect(api.assign).toHaveBeenCalledExactlyOnceWith({
      key: "HELP-7",
      assigneeId: "casey",
      expectedCurrentAssigneeId: "riley",
    });
    expect(s.detail().assigneeId).toBe("sam");
    expect(s.list().assigneeId).toBe("riley");
    expect(
      detailChangeErrorKey(s.feedback.onError.mock.calls[0][0], "assign"),
    ).toBe("workItems:journey.assignmentConflict");
    s.client.clear();
  });

  it.each([false, true])(
    "a mid-write read is preserved on refusal, then authoritative refetch wins (refetch fails: %s)",
    async (failRefetch) => {
      const s = setup();
      const held = deferred();
      api.state.mockReturnValue(held.promise);
      const get = vi.fn(async () => {
        if (failRefetch) throw new Error("read failed");
        return row({
          stateId: "server",
          stateName: "Server state",
          version: 9,
        });
      });
      const observer = new QueryObserver(s.client, {
        queryKey: detailKey,
        queryFn: get,
        staleTime: Number.POSITIVE_INFINITY,
      });
      const unsubscribe = observer.subscribe(() => {});
      const pending = startDetailStateChange(
        s.client,
        s.detail(),
        choice,
        s.feedback,
      );
      await tick();
      s.client.setQueryData(
        detailKey,
        row({ stateId: "read", stateName: "Read arrived", version: 8 }),
      );
      held.reject(new HttpError(422, "refused"));
      await pending;
      expect(get).toHaveBeenCalledOnce();
      expect(s.detail().stateId).toBe(failRefetch ? "read" : "server");
      if (failRefetch) expect(observer.getCurrentResult().isError).toBe(true);
      unsubscribe();
      s.client.clear();
    },
  );

  it("cancels existing detail/list reads before applying optimistic fields", async () => {
    const s = setup();
    const signals: AbortSignal[] = [];
    const read =
      () =>
      ({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return new Promise<never>(() => {});
      };
    const detailRead = s.client
      .fetchQuery({ queryKey: detailKey, queryFn: read() })
      .catch(() => {});
    const listRead = s.client
      .fetchQuery({ queryKey: listKey, queryFn: read() })
      .catch(() => {});
    const held = deferred();
    api.state.mockReturnValue(held.promise);
    const pending = startDetailStateChange(
      s.client,
      s.detail(),
      choice,
      s.feedback,
    );
    await tick();
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(s.detail().stateId).toBe("done");
    held.reject(new Error("offline"));
    await pending;
    await Promise.all([detailRead, listRead]);
    s.client.clear();
  });

  it("restores only a place still showing the optimistic group; preserves unrelated newer fields", async () => {
    const s = setup();
    const held = deferred();
    api.state.mockReturnValue(held.promise);
    const pending = startDetailStateChange(
      s.client,
      s.detail(),
      choice,
      s.feedback,
    );
    await tick();
    s.client.setQueryData(detailKey, {
      ...s.detail(),
      title: "New title",
      version: 10,
    });
    s.client.setQueryData(listKey, {
      pages: [{ items: [row({ stateId: "external", stateName: "External" })] }],
      pageParams: [undefined],
    });
    held.reject(new Error("offline"));
    await pending;
    expect(s.detail()).toMatchObject({
      stateId: "todo",
      title: "New title",
      version: 10,
    });
    expect(s.list().stateId).toBe("external");
    s.client.clear();
  });

  it("settles with captured item/project keys after the caller switches items or unmounts", async () => {
    const s = setup();
    const held = deferred();
    api.state.mockReturnValue(held.promise);
    const pending = startDetailStateChange(
      s.client,
      s.detail(),
      choice,
      s.feedback,
    );
    const otherKey = ["work-items", "detail", "OTHER-2"];
    s.client.setQueryData(otherKey, row({ key: "OTHER-2", projectId: "p2" }));
    const other = s.client.getQueryData(otherKey);
    await tick();
    held.resolve({ stateId: "done", version: 5 });
    await pending;
    expect(s.client.getQueryData(otherKey)).toBe(other);
    expect(s.client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(s.detail().version).toBe(5);
    s.client.clear();
  });

  it("seeded interleavings drive production writes, reads and actual refetches, enforcing one write and immutable preconditions", async () => {
    const covered = new Set<string>();
    let seed = 0xd100;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 8;
    };
    for (let round = 0; round < 48; round++) {
      const s = setup();
      const held = deferred();
      let inFlight = 0;
      let max = 0;
      const request = () => {
        inFlight++;
        max = Math.max(max, inFlight);
        return held.promise.finally(() => {
          inFlight--;
        });
      };
      api.state.mockImplementation(request);
      api.assign.mockImplementation(request);
      const truth = row({
        stateId: "server",
        stateName: "Server",
        assigneeId: "server-person",
        assigneeName: "Server person",
        version: 12,
      });
      const failRead = random() % 3 === 0;
      if (failRead) covered.add("refetch fails");
      const observer = new QueryObserver(s.client, {
        queryKey: detailKey,
        staleTime: Number.POSITIVE_INFINITY,
        queryFn: async () => {
          if (failRead) throw new Error("refetch failed");
          return truth;
        },
      });
      const unsubscribe = observer.subscribe(() => {});
      const shown = s.detail();
      const assignment = random() % 2 === 0;
      covered.add(assignment ? "choose assignee" : "choose state");
      const pending = assignment
        ? startDetailAssigneeChange(
            s.client,
            shown,
            person,
            shown.assigneeId,
            s.feedback,
          )
        : startDetailStateChange(s.client, shown, choice, s.feedback);
      expect(
        startDetailAssigneeChange(
          s.client,
          shown,
          person,
          shown.assigneeId,
          s.feedback,
        ),
      ).toBeUndefined();
      expect(
        startDetailStateChange(s.client, shown, choice, s.feedback),
      ).toBeUndefined();
      await tick();
      if (random() % 2) {
        covered.add("read lands");
        s.client.setQueryData(detailKey, truth);
      }
      const outcome = random() % 3;
      covered.add(["success", "refusal", "network failure"][outcome]);
      if (outcome === 0)
        held.resolve({
          stateId: "server",
          assigneeId: "server-person",
          version: 12,
        });
      else
        held.reject(
          outcome === 1 ? new HttpError(409, "refused") : new Error("network"),
        );
      await pending;
      if (assignment)
        expect(api.assign.mock.lastCall?.[0]).toEqual({
          key: shown.key,
          assigneeId: "casey",
          expectedCurrentAssigneeId: shown.assigneeId,
        });
      else
        expect(api.state.mock.lastCall?.[0]).toEqual({
          key: shown.key,
          toStateTemplateId: choice.toStateTemplateId,
        });
      expect(max).toBe(1);
      expect(inFlight).toBe(0);
      if (outcome !== 0) {
        expect(s.detail().stateId).not.toBe("done");
        expect(s.detail().assigneeId).not.toBe("casey");
        expect(s.list().stateId).toBe("review");
      }
      if (!failRead) expect(s.detail()).toEqual(truth);
      unsubscribe();
      s.client.clear();
    }
    expect([...covered].sort()).toEqual(
      [
        "choose assignee",
        "choose state",
        "network failure",
        "read lands",
        "refetch fails",
        "refusal",
        "success",
      ].sort(),
    );
  });
});

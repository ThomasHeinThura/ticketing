import { expect, it, vi } from "vitest";

// Every query resolves to whatever the next queued promise gives.
const queue = vi.hoisted(() => ({ next: vi.fn<() => Promise<unknown[]>>() }));
vi.mock("../../apps/api/src/database", () => {
  const chain: Record<string, unknown> = {};
  for (const name of [
    "select",
    "from",
    "where",
    "limit",
    "innerJoin",
    "leftJoin",
  ])
    chain[name] = () => chain;
  // biome-ignore lint/suspicious/noThenProperty: a drizzle query builder is awaited as a thenable
  chain.then = (resolve: (rows: unknown[]) => unknown, reject: () => unknown) =>
    queue.next().then(resolve, reject);
  return { default: chain, schema: new Proxy({}, { get: () => ({}) }) };
});

import {
  customerPortalScope,
  featureStateSomewhere,
  invalidateFeatureFlagCache,
} from "../../apps/api/src/feature-flag/enforce";

it("does not cache a lookup that started before a flag write", async () => {
  let release: (rows: unknown[]) => void = () => {};
  queue.next.mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  const inFlight = featureStateSomewhere("feature.customer_portal");
  await vi.waitFor(() => expect(queue.next).toHaveBeenCalledTimes(1));
  // The flag is turned off and the cache invalidated while the old read is pending.
  invalidateFeatureFlagCache();
  release([{ enabled: true, locked: true }]);
  expect(await inFlight).toBe("on");

  queue.next.mockResolvedValueOnce([{ enabled: false, locked: true }]);
  expect(await featureStateSomewhere("feature.customer_portal")).toBe("off");
});

it("does not cache a portal scope read that started before a flag write", async () => {
  const releases: Array<(rows: unknown[]) => void> = [];
  queue.next.mockImplementation(
    () => new Promise((resolve) => releases.push(resolve)),
  );
  const inFlight = customerPortalScope();
  await vi.waitFor(() => expect(releases).toHaveLength(3));
  // A project's portal is switched off while the old scope read is pending.
  invalidateFeatureFlagCache();
  releases[0]?.([{ enabled: true, locked: false }]);
  releases[1]?.([]);
  releases[2]?.([{ id: "project-1", enabled: true }]);
  expect((await inFlight)?.projects.get("project-1")).toBe(true);

  queue.next.mockReset();
  queue.next
    .mockResolvedValueOnce([{ enabled: true, locked: false }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "project-1", enabled: false }]);
  expect((await customerPortalScope())?.projects.get("project-1")).toBe(false);
});

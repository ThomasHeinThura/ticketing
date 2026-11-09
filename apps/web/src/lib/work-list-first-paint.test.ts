import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function load(pathname = "/agent/projects/WLP/work") {
  window.history.replaceState(null, "", pathname);
  return import("./work-list-first-paint");
}

async function isSettled(promise: Promise<void> | undefined) {
  let settled = false;
  void promise?.then(() => {
    settled = true;
  });
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  return settled;
}

describe("waitForWorkListFirstPaint (G11 work-list LCP)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("holds a direct visit's first paint until its rows are here", async () => {
    const { waitForWorkListFirstPaint } = await load();
    const reads = deferred();

    const wait = waitForWorkListFirstPaint({
      cause: "enter",
      reads: reads.promise,
    });

    expect(wait).toBeInstanceOf(Promise);
    expect(await isSettled(wait)).toBe(false);
    reads.resolve();
    expect(await isSettled(wait)).toBe(true);
  });

  it("stops waiting after the cap, so a slow API still shows the loading state", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { WORK_LIST_FIRST_PAINT_WAIT_MS, waitForWorkListFirstPaint } =
      await load();

    const wait = waitForWorkListFirstPaint({
      cause: "enter",
      reads: deferred().promise,
    });
    vi.advanceTimersByTime(WORK_LIST_FIRST_PAINT_WAIT_MS - 1);
    expect(await isSettled(wait)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await isSettled(wait)).toBe(true);
    expect(WORK_LIST_FIRST_PAINT_WAIT_MS).toBeLessThanOrEqual(300);
  });

  it("does not turn a failed read into a failed navigation", async () => {
    const { waitForWorkListFirstPaint } = await load();
    const reads = deferred();

    const wait = waitForWorkListFirstPaint({
      cause: "enter",
      reads: reads.promise,
    });
    reads.reject(new Error("offline"));

    await expect(wait).resolves.toBeUndefined();
  });

  it("waits only on the document's first entry into the work list", async () => {
    const { waitForWorkListFirstPaint } = await load();

    // The main entry's direct-visit preload does not use up the first entry.
    expect(
      waitForWorkListFirstPaint({ cause: "preload", reads: Promise.resolve() }),
    ).toBeInstanceOf(Promise);
    expect(
      waitForWorkListFirstPaint({ cause: "enter", reads: Promise.resolve() }),
    ).toBeInstanceOf(Promise);
    expect(
      waitForWorkListFirstPaint({ cause: "enter", reads: Promise.resolve() }),
    ).toBeUndefined();
  });

  it("does not wait again once the first wait has settled, even without an entry", async () => {
    const { waitForWorkListFirstPaint } = await load();

    // The router may reuse the direct-visit preload's loader for the entry.
    await waitForWorkListFirstPaint({
      cause: "preload",
      reads: Promise.resolve(),
    });
    expect(
      waitForWorkListFirstPaint({ cause: "enter", reads: Promise.resolve() }),
    ).toBeUndefined();
  });

  it("never waits on a search change, without reads, or when the page opened elsewhere", async () => {
    const first = await load();
    expect(
      first.waitForWorkListFirstPaint({
        cause: "stay",
        reads: Promise.resolve(),
      }),
    ).toBeUndefined();
    expect(
      first.waitForWorkListFirstPaint({ cause: "enter", reads: undefined }),
    ).toBeUndefined();

    vi.resetModules();
    const elsewhere = await load("/agent/my-work");
    expect(
      elsewhere.waitForWorkListFirstPaint({
        cause: "enter",
        reads: Promise.resolve(),
      }),
    ).toBeUndefined();
  });
});

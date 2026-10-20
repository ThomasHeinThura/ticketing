import { afterEach, describe, expect, it, vi } from "vitest";
import {
  afterPrimaryContent,
  waitsForPrimaryContent,
} from "./after-primary-content";

vi.mock("@/lib/i18n/after-first-paint", () => ({
  afterFirstPaint: () => Promise.resolve(),
}));

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function track(promise: Promise<void>) {
  const state = { resolved: false, rejected: false };
  promise.then(
    () => {
      state.resolved = true;
    },
    () => {
      state.rejected = true;
    },
  );
  return state;
}

describe("waitsForPrimaryContent", () => {
  it("is true only on the work list and boards", () => {
    expect(waitsForPrimaryContent("/agent/projects/HELP/work")).toBe(true);
    expect(waitsForPrimaryContent("/agent/projects/HELP/board")).toBe(true);
    expect(waitsForPrimaryContent("/agent/inbox")).toBe(false);
    expect(waitsForPrimaryContent("/agent/settings/account")).toBe(false);
  });
});

describe("afterPrimaryContent", () => {
  it("waits for the work list to mark its rows rendered", async () => {
    window.history.replaceState(null, "", "/agent/projects/HELP/work");
    const state = track(afterPrimaryContent());
    await flush();
    expect(state.resolved).toBe(false);

    const list = document.createElement("div");
    list.setAttribute("data-primary-content-ready", "true");
    document.body.append(list);
    await flush();
    expect(state.resolved).toBe(true);
  });

  it("resolves when an existing element flips its marker on", async () => {
    window.history.replaceState(null, "", "/agent/projects/HELP/board");
    const board = document.createElement("div");
    document.body.append(board);
    const state = track(afterPrimaryContent());
    await flush();
    expect(state.resolved).toBe(false);

    board.setAttribute("data-primary-content-ready", "true");
    await flush();
    expect(state.resolved).toBe(true);
  });

  it("stops waiting when the user leaves for a page without the marker", async () => {
    window.history.replaceState(null, "", "/agent/projects/HELP/work");
    const state = track(afterPrimaryContent());
    await flush();
    expect(state.resolved).toBe(false);

    window.history.replaceState(null, "", "/agent/inbox");
    document.body.append(document.createElement("div"));
    await flush();
    expect(state.resolved).toBe(true);
  });

  it("disconnects its observer once it resolves", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    window.history.replaceState(null, "", "/agent/projects/HELP/work");
    const done = afterPrimaryContent();
    const list = document.createElement("div");
    list.setAttribute("data-primary-content-ready", "true");
    document.body.append(list);
    await done;
    expect(disconnect).toHaveBeenCalled();
  });

  it("rejects and disconnects when aborted", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    window.history.replaceState(null, "", "/agent/projects/HELP/work");
    const abort = new AbortController();
    const state = track(afterPrimaryContent({ signal: abort.signal }));
    abort.abort();
    await flush();
    expect(state.rejected).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });

  it("does not wait on screens without a primary-content marker", async () => {
    window.history.replaceState(null, "", "/agent/inbox");
    await expect(afterPrimaryContent()).resolves.toBeUndefined();
  });

  it("falls back to a timer when the marker never appears", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/agent/projects/HELP/work");
    const state = track(afterPrimaryContent({ timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(999);
    expect(state.resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.resolved).toBe(true);
  });
});

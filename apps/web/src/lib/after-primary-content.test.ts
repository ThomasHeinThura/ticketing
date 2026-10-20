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
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    let resolved = false;
    void afterPrimaryContent().then(() => {
      resolved = true;
    });
    await flush();
    expect(resolved).toBe(false);

    const list = document.createElement("div");
    list.setAttribute("data-primary-content-ready", "true");
    document.body.append(list);
    await flush();
    expect(resolved).toBe(true);
  });

  it("does not wait on screens without a primary-content marker", async () => {
    window.history.replaceState(null, "", "/agent/inbox");
    await expect(afterPrimaryContent()).resolves.toBeUndefined();
  });

  it("falls back to a timer when the marker never appears", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/agent/projects/HELP/work");
    let resolved = false;
    void afterPrimaryContent({ timeoutMs: 1_000 }).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).toBe(true);
  });
});

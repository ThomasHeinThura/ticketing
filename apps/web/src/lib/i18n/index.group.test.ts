import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Group mode is chosen once at module load from the URL, so each test sets the URL, resets the
// module registry and imports `./index` afresh.
const afterPaint = vi.hoisted(() => ({
  release: () => {},
  gate: Promise.resolve(),
}));

vi.mock("./after-first-paint", () => ({
  afterFirstPaint: () => afterPaint.gate,
}));

const rest = vi.hoisted(() => ({ fail: 0, requests: 0 }));

vi.mock("virtual:taskdesk-i18n/loaders-rest", async () => {
  const actual = await vi.importActual<{
    default: Record<string, () => Promise<unknown>>;
  }>("virtual:taskdesk-i18n/loaders-rest");
  return {
    default: new Proxy(actual.default, {
      get(target, locale: string) {
        return () => {
          rest.requests += 1;
          if (rest.fail > 0) {
            rest.fail -= 1;
            return Promise.reject(new Error("rest chunk failed"));
          }
          return target[locale]();
        };
      },
    }),
  };
});

async function importInGroupMode(path = "/agent/projects/WLP/work") {
  window.history.pushState({}, "", path);
  vi.resetModules();
  let release!: () => void;
  afterPaint.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  afterPaint.release = release;
  return import("./index");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("i18n group mode on the work list", () => {
  beforeEach(() => {
    rest.fail = 0;
    rest.requests = 0;
  });
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("paints with the first-paint namespaces and defers every other one until after first paint", async () => {
    const { i18n } = await importInGroupMode();
    await flush();

    expect(i18n.t("workItems:list.heading")).not.toBe("workItems:list.heading");
    expect(i18n.t("navigation:page.projectsTitle")).not.toBe(
      "navigation:page.projectsTitle",
    );
    expect(rest.requests).toBe(0);
    expect(i18n.hasLoadedNamespace("settings")).toBe(false);
    expect(i18n.hasLoadedNamespace("tasks")).toBe(false);

    afterPaint.release();
    await vi.waitFor(() => expect(rest.requests).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(i18n.hasLoadedNamespace("settings")).toBe(true),
    );
    expect(i18n.hasLoadedNamespace("settings")).toBe(true);
    expect(i18n.hasLoadedNamespace("tasks")).toBe(true);
  });

  it("whenAllNamespacesLoaded loads the deferred group without waiting for first paint", async () => {
    const { i18n, whenAllNamespacesLoaded } = await importInGroupMode();
    await whenAllNamespacesLoaded();
    expect(i18n.hasLoadedNamespace("settings")).toBe(true);
  });

  it("retries once, then falls back to the full catalog, never leaving keys unresolved", async () => {
    const { i18n, whenAllNamespacesLoaded } = await importInGroupMode();
    rest.fail = 1;
    await whenAllNamespacesLoaded();
    expect(i18n.hasLoadedNamespace("settings")).toBe(true);
  });

  it("serves the full catalog when the deferred group keeps failing", async () => {
    const { i18n, whenAllNamespacesLoaded } = await importInGroupMode();
    rest.fail = 10;
    await whenAllNamespacesLoaded();
    expect(i18n.hasLoadedNamespace("settings")).toBe(true);
    expect(i18n.t("tasks:assignee.unassigned")).not.toBe(
      "tasks:assignee.unassigned",
    );
  });

  it("does nothing special outside the work list", async () => {
    const { i18n, whenAllNamespacesLoaded } =
      await importInGroupMode("/dashboard");
    await whenAllNamespacesLoaded();
    await flush();
    expect(i18n.hasLoadedNamespace("settings")).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { warmWorkItemSidePane } from "./load-work-item-side-pane";

const mocks = vi.hoisted(() => ({
  strings: vi.fn(() => Promise.resolve()),
  detail: vi.fn(() => Promise.resolve()),
  body: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ whenAllNamespacesLoaded: mocks.strings }));
vi.mock("./work-item-side-pane", () => ({
  default: () => null,
  loadWorkItemSidePaneBody: async () => {
    mocks.body();
    return { warmWorkItemDetail: mocks.detail };
  },
}));

function connection(value: object | undefined) {
  Object.defineProperty(navigator, "connection", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  connection(undefined);
  vi.clearAllMocks();
});

describe("warmWorkItemSidePane", () => {
  it("loads the body, the detail code and then the deferred strings", async () => {
    await warmWorkItemSidePane();
    expect(mocks.body).toHaveBeenCalledOnce();
    expect(mocks.detail).toHaveBeenCalledOnce();
    expect(mocks.strings).toHaveBeenCalledOnce();
  });

  it.each([
    ["Save-Data", { saveData: true, effectiveType: "4g" }],
    ["2g", { saveData: false, effectiveType: "2g" }],
    ["slow-2g", { saveData: false, effectiveType: "slow-2g" }],
  ])("downloads nothing on %s", async (_name, hints) => {
    connection(hints);
    await warmWorkItemSidePane();
    expect(mocks.body).not.toHaveBeenCalled();
    expect(mocks.strings).not.toHaveBeenCalled();
  });

  it("warms on a fast connection", async () => {
    connection({ saveData: false, effectiveType: "4g" });
    await warmWorkItemSidePane();
    expect(mocks.strings).toHaveBeenCalledOnce();
  });

  it("starts nothing once the user has left, and stops before the strings", async () => {
    const left = new AbortController();
    left.abort();
    await warmWorkItemSidePane(left.signal);
    expect(mocks.body).not.toHaveBeenCalled();

    const leavingMidWarm = new AbortController();
    mocks.detail.mockImplementationOnce(() => {
      leavingMidWarm.abort();
      return Promise.resolve();
    });
    await warmWorkItemSidePane(leavingMidWarm.signal);
    expect(mocks.strings).not.toHaveBeenCalled();
  });

  it("starts no further download when the user leaves while the body loads", async () => {
    const left = new AbortController();
    mocks.body.mockImplementationOnce(() => left.abort());
    await warmWorkItemSidePane(left.signal);
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.strings).not.toHaveBeenCalled();
  });

  it("swallows a failed download: the pane loads normally when opened", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("chunk failed"));
    await expect(warmWorkItemSidePane()).resolves.toBeUndefined();
  });
});

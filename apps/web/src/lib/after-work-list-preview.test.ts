import { afterEach, describe, expect, it, vi } from "vitest";
import { afterWorkListPreview } from "./after-work-list-preview";

describe("afterWorkListPreview", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("waits for the preview and two frames, without requiring primary content", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const root = document.createElement("div");
    document.body.append(root);
    const load = vi.fn();
    const abort = new AbortController();
    afterWorkListPreview(root, abort.signal, load);
    expect(load).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    root.innerHTML = '<div data-testid="work-item-list-preview"></div>';
    await Promise.resolve();
    expect(frames).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
    frames[0](0);
    expect(load).not.toHaveBeenCalled();
    frames[1](0);
    expect(load).toHaveBeenCalledOnce();
    root.append(document.createElement("span"));
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
  });

  it("disposes before preview insertion without starting the loader", async () => {
    const root = document.createElement("div");
    const load = vi.fn();
    const dispose = afterWorkListPreview(
      root,
      new AbortController().signal,
      load,
    );
    dispose();
    dispose();
    root.innerHTML = '<div data-testid="work-item-list-preview"></div>';
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });

  it("cancels the pending second frame and never calls the loader after abort", () => {
    const frames: FrameRequestCallback[] = [];
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const root = document.createElement("div");
    root.innerHTML = '<div data-testid="work-item-list-preview"></div>';
    const abort = new AbortController();
    const load = vi.fn();
    afterWorkListPreview(root, abort.signal, load);
    frames[0](0);
    abort.abort();
    expect(cancel).toHaveBeenCalledWith(2);
    frames[1](0);
    expect(load).not.toHaveBeenCalled();
  });
});

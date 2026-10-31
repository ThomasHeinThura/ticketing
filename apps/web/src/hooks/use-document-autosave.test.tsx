import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  options: null as null | {
    shouldBlockFn: (args: {
      current: { pathname: string };
      next: { pathname: string };
    }) => boolean | Promise<boolean>;
    enableBeforeUnload: () => boolean;
    disabled: boolean;
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useBlocker: (options: NonNullable<typeof router.options>) => {
    router.options = options;
    return { status: "idle" };
  },
}));

import { HttpError } from "@/lib/http-error";
import {
  DOCUMENT_AUTOSAVE_DELAY_MS,
  DOCUMENT_AUTOSAVE_RETRY_DELAYS_MS,
  type DocumentAutosaveOptions,
  useDocumentAutosave,
} from "./use-document-autosave";

class Conflict extends Error {}

type Changes = { body: number };
type Saved = { version: number };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(
  overrides: Partial<DocumentAutosaveOptions<Changes, Saved>> = {},
) {
  const draft = { body: 0 };
  const sent = { body: 0 };
  const save = vi.fn(
    async (_changes: Changes, expected: number): Promise<Saved> => ({
      version: expected + 1,
    }),
  );
  const onConflict = vi.fn();
  const onError = vi.fn();
  const onSaved = vi.fn((_result: Saved, changes: Changes) => {
    sent.body = changes.body;
  });
  const hook = renderHook(() =>
    useDocumentAutosave<Changes, Saved>({
      version: 4,
      getChanges: () =>
        draft.body !== sent.body ? { body: draft.body } : null,
      save,
      isConflict: (error) => error instanceof Conflict,
      onSaved,
      onConflict,
      onError,
      ...overrides,
    }),
  );
  const type = (body: number) => {
    draft.body = body;
    act(() => hook.result.current.markDirty());
  };
  return { hook, draft, save, onSaved, onConflict, onError, type };
}

async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  router.options = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentAutosave", () => {
  it("saves once, 1.5 s after the last edit", async () => {
    const { hook, save, type } = setup();
    type(1);
    await elapse(1000);
    type(2);
    await elapse(1000);
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("unsaved");
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS - 1000);
    expect(save).toHaveBeenCalledExactlyOnceWith({ body: 2 }, 4);
    expect(hook.result.current.status).toBe("saved");
    expect(hook.result.current.baseVersion()).toBe(5);
  });

  it("never saves without an edit (Tiptap's own mount updates never reach it)", async () => {
    const { hook, save } = setup();
    hook.rerender();
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS * 3);
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("saved");
    expect(hook.result.current.hasUnsavedChanges()).toBe(false);
  });

  it("keeps one save in flight and chains each save on the version the last one returned", async () => {
    const first = deferred<Saved>();
    const { hook, save, type } = setup();
    save.mockImplementationOnce(() => first.promise);
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("saving");

    // Edits during the save wait for it, even when their own delay runs out.
    type(2);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ version: 9 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, { body: 2 }, 9);
    expect(hook.result.current.baseVersion()).toBe(10);
    expect(hook.result.current.status).toBe("saved");
  });

  it("does not mark edits made during a save as saved", async () => {
    const first = deferred<Saved>();
    const { hook, save, type } = setup();
    save.mockImplementationOnce(() => first.promise);
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    type(2);
    await act(async () => {
      first.resolve({ version: 5 });
      await vi.advanceTimersByTimeAsync(0);
    });
    // The second edit's delay is still running.
    expect(hook.result.current.status).toBe("unsaved");
    expect(hook.result.current.hasUnsavedChanges()).toBe(true);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenLastCalledWith({ body: 2 }, 5);
    expect(hook.result.current.status).toBe("saved");
  });

  it("pauses on a 409 and opens the conflict dialog without retrying", async () => {
    const { hook, save, type, onConflict } = setup();
    const conflict = new Conflict();
    save.mockRejectedValueOnce(conflict);
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(onConflict).toHaveBeenCalledExactlyOnceWith(conflict);
    expect(hook.result.current.status).toBe("paused");

    type(2);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS * 3);
    let flushed = true;
    await act(async () => {
      flushed = await hook.result.current.flush();
    });
    expect(flushed).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    // Overwrite: continue from the server's version and send the edits once.
    act(() => hook.result.current.resume(12));
    await act(async () => {
      flushed = await hook.result.current.flush();
    });
    expect(flushed).toBe(true);
    expect(save).toHaveBeenLastCalledWith({ body: 2 }, 12);
    expect(hook.result.current.status).toBe("saved");
  });

  it("reopens the conflict dialog on Ctrl/⌘+S while paused", async () => {
    const { save, type, onConflict } = setup();
    const conflict = new Conflict();
    save.mockRejectedValueOnce(conflict);
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true }),
      );
    });
    expect(onConflict).toHaveBeenCalledTimes(2);
    expect(onConflict).toHaveBeenLastCalledWith(conflict);
  });

  it("drops unsaved edits and an in-flight result on reset", async () => {
    const first = deferred<Saved>();
    const { hook, save, type, onSaved } = setup();
    save.mockImplementationOnce(() => first.promise);
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    act(() => hook.result.current.reset(20));
    await act(async () => {
      first.resolve({ version: 5 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.result.current.baseVersion()).toBe(20);
    expect(hook.result.current.status).toBe("saved");
  });

  it("keeps edits unsaved after another failure and sends them with the next edit", async () => {
    const { hook, save, type, onError } = setup();
    save.mockRejectedValueOnce(new Error("offline"));
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("unsaved");
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
    type(2);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenLastCalledWith({ body: 2 }, 4);
    expect(hook.result.current.status).toBe("saved");
  });

  it("retries a network or server failure after 5 s, 15 s and 30 s, then waits for the next edit", async () => {
    const { hook, save, type, onError } = setup();
    save.mockRejectedValue(new HttpError(503, "unavailable"));
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(DOCUMENT_AUTOSAVE_RETRY_DELAYS_MS).toEqual([5000, 15_000, 30_000]);
    for (const [index, delay] of DOCUMENT_AUTOSAVE_RETRY_DELAYS_MS.entries()) {
      await elapse(delay - 1);
      expect(save).toHaveBeenCalledTimes(index + 1);
      await elapse(1);
      expect(save).toHaveBeenCalledTimes(index + 2);
      expect(save).toHaveBeenLastCalledWith({ body: 1 }, 4);
    }
    // Reported once, not for each automatic retry.
    expect(onError).toHaveBeenCalledTimes(1);
    await elapse(120_000);
    expect(save).toHaveBeenCalledTimes(4);
    expect(hook.result.current.status).toBe("unsaved");

    // The next edit starts over and, once the server is back, saves.
    save.mockImplementation(async (_changes, expected) => ({
      version: expected + 1,
    }));
    type(2);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenLastCalledWith({ body: 2 }, 4);
    expect(hook.result.current.status).toBe("saved");
  });

  it("saves on the first retry once the connection is back", async () => {
    const { hook, save, type } = setup();
    save.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(hook.result.current.status).toBe("unsaved");
    await elapse(DOCUMENT_AUTOSAVE_RETRY_DELAYS_MS[0]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe("saved");
    expect(hook.result.current.baseVersion()).toBe(5);
  });

  it("does not retry a refusal, and reset cancels a pending retry", async () => {
    const refused = setup();
    refused.save.mockRejectedValueOnce(new HttpError(422, "invalid"));
    refused.type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    await elapse(60_000);
    expect(refused.save).toHaveBeenCalledTimes(1);
    refused.hook.unmount();

    const { hook, save, type } = setup();
    save.mockRejectedValueOnce(new HttpError(500, "boom"));
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    act(() => hook.result.current.reset(9));
    await elapse(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("saved");
  });

  it("holds the save while the draft cannot be sent", async () => {
    let valid = false;
    const { hook, save, type } = setup({ canSave: () => valid });
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("unsaved");
    valid = true;
    type(2);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledExactlyOnceWith({ body: 2 }, 4);
  });

  it("flushes at once on blur or Ctrl/⌘+S", async () => {
    const { hook, save, type } = setup();
    type(1);
    await act(async () => {
      await hook.result.current.flush();
    });
    expect(save).toHaveBeenCalledExactlyOnceWith({ body: 1 }, 4);
    type(2);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
      );
    });
    await elapse(0);
    expect(save).toHaveBeenLastCalledWith({ body: 2 }, 5);
    // Neither flush leaves a second, delayed save behind.
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("saves pending edits when the screen unmounts", async () => {
    const { hook, save, type } = setup();
    type(1);
    hook.unmount();
    await elapse(0);
    expect(save).toHaveBeenCalledExactlyOnceWith({ body: 1 }, 4);
  });

  it("sends edits left after a save in flight when the screen unmounts", async () => {
    const first = deferred<Saved>();
    const { hook, save, type } = setup();
    save.mockImplementationOnce(() => first.promise);
    type(1);
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    type(2);
    hook.unmount();
    await act(async () => {
      first.resolve({ version: 5 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenLastCalledWith({ body: 2 }, 5);
  });

  it("lets navigation through once the edits are saved, and warns only while some are not", async () => {
    const { save, type } = setup();
    const leave = { current: { pathname: "/a" }, next: { pathname: "/b" } };
    expect(router.options?.enableBeforeUnload()).toBe(false);
    await expect(router.options?.shouldBlockFn(leave)).resolves.toBe(false);

    type(1);
    expect(router.options?.enableBeforeUnload()).toBe(true);
    let blocked: boolean | undefined;
    await act(async () => {
      blocked = await router.options?.shouldBlockFn(leave);
    });
    expect(blocked).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(router.options?.enableBeforeUnload()).toBe(false);

    save.mockRejectedValueOnce(new Conflict());
    type(2);
    await act(async () => {
      blocked = await router.options?.shouldBlockFn(leave);
    });
    expect(blocked).toBe(true);
    // Search-only navigation (the KB customer preview) stays on the page.
    await expect(
      router.options?.shouldBlockFn({
        current: { pathname: "/a" },
        next: { pathname: "/a" },
      }),
    ).resolves.toBe(false);
  });

  it("does nothing when disabled", async () => {
    const { hook, save } = setup({ enabled: false });
    act(() => hook.result.current.markDirty());
    await elapse(DOCUMENT_AUTOSAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();
    expect(router.options?.disabled).toBe(true);
  });
});

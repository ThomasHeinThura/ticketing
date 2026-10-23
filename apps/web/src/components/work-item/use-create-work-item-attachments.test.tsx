import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/fetchers/attachment/work-item-attachments", () => ({
  resumeWorkItemAttachment: mocks.upload,
}));

import { useCreateWorkItemAttachments } from "./use-create-work-item-attachments";

beforeEach(() => {
  mocks.upload.mockReset();
});
it("stages without persistence, retains successful siblings and retries failed checkpoints only", async () => {
  const { result } = renderHook(() => useCreateWorkItemAttachments("ws:p"));
  const a = new File(["a"], "same.txt");
  const b = new File(["b"], "same.txt");
  act(() => result.current.stage([a, b]));
  expect(mocks.upload).not.toHaveBeenCalled();
  const checkpoint = {
    attachmentId: "b-id",
    uploadUrl: "https://storage/b",
    uploadHeaders: {},
    uploaded: true,
  };
  mocks.upload
    .mockResolvedValueOnce({ id: "a-id" })
    .mockImplementationOnce(async (_key, _file, _old, save) => {
      save(checkpoint);
      throw new Error("lost completion");
    });
  await act(async () => {
    expect(await result.current.upload("HELP-1")).toBe(false);
  });
  expect(result.current.rows.map((row) => row.state)).toEqual([
    "ready",
    "failed",
  ]);
  mocks.upload.mockResolvedValueOnce({ id: "b-id" });
  await act(async () => {
    expect(await result.current.upload("HELP-1")).toBe(true);
  });
  expect(mocks.upload).toHaveBeenCalledTimes(3);
  expect(mocks.upload.mock.calls[2]?.slice(0, 3)).toEqual([
    "HELP-1",
    b,
    checkpoint,
  ]);
});
it("removes local selections without writes and clears rows on scope changes", () => {
  const { result, rerender } = renderHook(
    ({ scope }) => useCreateWorkItemAttachments(scope),
    { initialProps: { scope: "a" } },
  );
  act(() => result.current.stage([new File(["a"], "a.txt")]));
  act(() => result.current.remove(result.current.rows[0]?.id ?? -1));
  expect(result.current.rows).toEqual([]);
  act(() => result.current.stage([new File(["b"], "b.txt")]));
  rerender({ scope: "b" });
  expect(result.current.rows).toEqual([]);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("lets a failed file be dropped while an attached one stays", async () => {
  const { result } = renderHook(() => useCreateWorkItemAttachments("ws:p"));
  act(() =>
    result.current.stage([new File(["a"], "a.txt"), new File(["b"], "b.txt")]),
  );
  mocks.upload
    .mockResolvedValueOnce({ id: "a-id" })
    .mockRejectedValueOnce(new Error("blocked"));
  await act(async () => {
    expect(await result.current.upload("HELP-1")).toBe(false);
  });
  const [attached, failed] = result.current.rows;
  act(() => result.current.remove(attached?.id ?? -1));
  expect(result.current.rows).toHaveLength(2);
  act(() => result.current.remove(failed?.id ?? -1));
  expect(result.current.rows.map((row) => row.state)).toEqual(["ready"]);
});
it("blocks overlapping uploads and ignores a completion after scope change", async () => {
  let finish!: (value: unknown) => void;
  mocks.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(
    ({ scope }) => useCreateWorkItemAttachments(scope),
    { initialProps: { scope: "a" } },
  );
  act(() => result.current.stage([new File(["a"], "a.txt")]));
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.upload("HELP-1");
  });
  expect(await result.current.upload("HELP-1")).toBe(false);
  rerender({ scope: "b" });
  await act(async () => {
    finish({ id: "ready" });
    await pending;
  });
  expect(result.current.rows).toEqual([]);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});

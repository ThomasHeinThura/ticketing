import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNumberedShortcuts } from "./use-numbered-shortcuts";

afterEach(cleanup);
it("keeps original numeric indices and skips disabled options, editable descendants and modified/composing keys", () => {
  const first = vi.fn();
  const second = vi.fn();
  renderHook(() =>
    useNumberedShortcuts(true, [
      { onSelect: first, disabled: true },
      { onSelect: second },
    ]),
  );
  fireEvent.keyDown(document.body, { key: "1" });
  for (const props of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: true },
    { repeat: true },
    { isComposing: true },
  ])
    fireEvent.keyDown(document.body, { key: "2", ...props });
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  const descendant = document.createElement("span");
  editor.append(descendant);
  document.body.append(editor);
  fireEvent.keyDown(descendant, { key: "2" });
  editor.remove();
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: "2" });
  expect(second).toHaveBeenCalledTimes(1);
});
it("removes the listener when closed or unmounted", () => {
  const select = vi.fn();
  const view = renderHook(
    ({ open }) => useNumberedShortcuts(open, [{ onSelect: select }]),
    { initialProps: { open: true } },
  );
  fireEvent.keyDown(document.body, { key: "1" });
  view.rerender({ open: false });
  fireEvent.keyDown(document.body, { key: "1" });
  view.unmount();
  fireEvent.keyDown(document.body, { key: "1" });
  expect(select).toHaveBeenCalledTimes(1);
});

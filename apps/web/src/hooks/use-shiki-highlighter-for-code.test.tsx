import { act, renderHook, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShikiHighlighterForCode } from "./use-shiki-highlighter-for-code";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/lib/shiki-highlighter", () => ({
  getSharedShikiHighlighter: mocks.load,
}));

function makeEditor(initialCodeBlock = false) {
  let hasCodeBlock = initialCodeBlock;
  const listeners = new Set<
    (event: { transaction: { docChanged: boolean } }) => void
  >();
  const editor = {
    state: {
      get doc() {
        return {
          descendants: (
            visit: (node: { type: { name: string } }) => boolean,
          ) => {
            if (hasCodeBlock) visit({ type: { name: "codeBlock" } });
          },
        };
      },
    },
    on: (
      _event: "transaction",
      listener: (event: { transaction: { docChanged: boolean } }) => void,
    ) => listeners.add(listener),
    off: (
      _event: "transaction",
      listener: (event: { transaction: { docChanged: boolean } }) => void,
    ) => listeners.delete(listener),
  } as unknown as Editor;

  return {
    editor,
    insertCodeBlock() {
      hasCodeBlock = true;
      for (const listener of listeners) {
        listener({ transaction: { docChanged: true } });
      }
    },
  };
}

describe("useShikiHighlighterForCode", () => {
  beforeEach(() => {
    mocks.load.mockReset();
  });

  it("waits until an editor has a code block before loading Shiki", async () => {
    const instance = { codeToTokens: vi.fn() };
    mocks.load.mockResolvedValue(instance);
    const { editor, insertCodeBlock } = makeEditor();
    const { result } = renderHook(() => useShikiHighlighterForCode(editor));

    expect(mocks.load).not.toHaveBeenCalled();
    act(() => insertCodeBlock());
    await waitFor(() => expect(result.current).toBe(instance));
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it("loads Shiki for code blocks already present during editor hydration", async () => {
    const instance = { codeToTokens: vi.fn() };
    mocks.load.mockResolvedValue(instance);
    const { editor } = makeEditor(true);
    const { result } = renderHook(() => useShikiHighlighterForCode(editor));

    await waitFor(() => expect(result.current).toBe(instance));
    expect(mocks.load).toHaveBeenCalledOnce();
  });
});

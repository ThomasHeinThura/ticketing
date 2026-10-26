import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidBlock } from "./mermaid-block";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn<(id: string, code: string) => Promise<{ svg: string }>>(),
  toastError: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: { initialize: mocks.initialize, render: mocks.render },
}));

vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError } }));

const editors: Editor[] = [];
let nextCodeId = 0;

function diagram(label = `Diagram ${++nextCodeId}`) {
  return `flowchart TD\n  A[${label}] --> B[Done]`;
}

function editorContent(codes: string[]) {
  return {
    type: "doc",
    content: codes.map((code) => ({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: code }],
    })),
  };
}

function mountEditor(codes: string[]) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, MermaidBlock],
    content: editorContent(codes),
  });
  editors.push(editor);
  return { editor, element };
}

function renderedPreviews(element: HTMLElement) {
  return [
    ...element.querySelectorAll<HTMLElement>(".taskdesk-mermaid-preview"),
  ];
}

function svgFor(code: string) {
  const label = code.match(/A\[([^\]]+)\]/u)?.[1] ?? "diagram";
  return `<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  mocks.initialize.mockReset();
  mocks.render.mockReset();
  mocks.render.mockImplementation(async (_id, code) => ({ svg: svgFor(code) }));
  mocks.toastError.mockReset();
  nextCodeId = 0;
});

afterEach(() => {
  for (const editor of editors.splice(0)) {
    if (!editor.isDestroyed) editor.destroy();
  }
  document.body.replaceChildren();
});

describe("MermaidBlock shared render lifecycle", () => {
  it("notifies a second editor that joins an in-flight render", async () => {
    const code = diagram("shared pending render");
    const result = deferred<{ svg: string }>();
    mocks.render.mockReturnValue(result.promise);

    const first = mountEditor([code]);
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    const second = mountEditor([code]);

    expect(renderedPreviews(first.element)[0]?.dataset.state).toBe("loading");
    expect(renderedPreviews(second.element)[0]?.dataset.state).toBe("loading");
    expect(mocks.render).toHaveBeenCalledTimes(1);

    result.resolve({ svg: svgFor(code) });
    await vi.waitFor(() => {
      expect(renderedPreviews(first.element)[0]?.dataset.state).toBe("done");
      expect(renderedPreviews(second.element)[0]?.dataset.state).toBe("done");
    });
  });

  it("uses a completed cached render in a later editor", async () => {
    const code = diagram("cached render");
    const first = mountEditor([code]);

    await vi.waitFor(() =>
      expect(renderedPreviews(first.element)[0]?.dataset.state).toBe("done"),
    );
    const second = mountEditor([code]);

    expect(renderedPreviews(second.element)[0]?.dataset.state).toBe("done");
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicit terminal error preview after rejection", async () => {
    const code = diagram("rejected render");
    const result = deferred<{ svg: string }>();
    mocks.render.mockReturnValue(result.promise);
    const first = mountEditor([code]);
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    const second = mountEditor([code]);
    result.reject(new Error("renderer failure detail"));

    await vi.waitFor(() => {
      expect(renderedPreviews(first.element)[0]?.dataset.state).toBe("error");
      expect(renderedPreviews(second.element)[0]?.dataset.state).toBe("error");
    });
    for (const { element } of [first, second]) {
      const preview = renderedPreviews(element)[0];
      expect(preview).toHaveAttribute("role", "status");
      expect(preview?.textContent).toBeTruthy();
      expect(preview?.textContent).not.toContain("renderer failure detail");
    }
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it("removes only a destroyed editor's subscription to a pending render", async () => {
    const code = diagram("unmount pending render");
    const result = deferred<{ svg: string }>();
    mocks.render.mockReturnValue(result.promise);
    const first = mountEditor([code]);
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    const second = mountEditor([code]);

    first.editor.destroy();
    result.resolve({ svg: svgFor(code) });

    await vi.waitFor(() =>
      expect(renderedPreviews(second.element)[0]?.dataset.state).toBe("done"),
    );
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("retains more than twenty renders while multiple editors use them", async () => {
    const codes = Array.from({ length: 22 }, (_, index) =>
      diagram(`active ${index}`),
    );
    const mounted = codes.map((code) => mountEditor([code]));

    await vi.waitFor(() => {
      expect(mocks.render).toHaveBeenCalledTimes(22);
      for (const { element } of mounted) {
        expect(renderedPreviews(element)[0]?.dataset.state).toBe("done");
      }
    });
    const renderCallCount = mocks.render.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const { element } of mounted) {
      expect(renderedPreviews(element)[0]?.dataset.state).toBe("done");
    }
    expect(renderCallCount).toBe(22);
    expect(mocks.render).toHaveBeenCalledTimes(22);
  });
});

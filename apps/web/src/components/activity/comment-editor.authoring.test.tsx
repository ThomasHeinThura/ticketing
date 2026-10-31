import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-test" } }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);

vi.mock("@/hooks/use-shiki-highlighter-for-code", () => ({
  useShikiHighlighterForCode: () => null,
}));

import CommentEditor, {
  describeEditorShortcut,
} from "@/components/activity/comment-editor";

afterEach(async () => {
  cleanup();
  // Tiptap React defers disposal by one millisecond to survive StrictMode remounts.
  await new Promise((resolve) => setTimeout(resolve, 1));
});

const label = (key: string) => translate(`activity:comment.editor.${key}`);

async function renderEditor(
  props: Partial<Parameters<typeof CommentEditor>[0]> = {},
) {
  const view = render(
    <CommentEditor value="" showQuickAttachButton={false} {...props} />,
  );
  const dom = await waitFor(() => {
    const element = view.container.querySelector<
      HTMLElement & { editor?: Editor }
    >('.ProseMirror[contenteditable="true"]');
    expect(element?.editor).toBeDefined();
    return element as HTMLElement & { editor: Editor };
  });
  return { ...view, dom, editor: dom.editor };
}

async function openSlashMenu(editor: Editor, text = "/") {
  await act(async () => {
    editor.commands.insertContent(text);
  });
  return waitFor(() =>
    screen.getByRole("listbox", { name: label("slashMenuLabel") }),
  );
}

function optionNames(listbox: HTMLElement) {
  return within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

function topLevelNodes(editor: Editor): JSONContent[] {
  return editor.getJSON().content ?? [];
}

describe("CommentEditor slash menu", () => {
  it("is an accessible listbox driven from the editor without taking focus", async () => {
    const { dom, editor } = await renderEditor();
    const listbox = await openSlashMenu(editor);

    const options = within(listbox).getAllByRole("option");
    expect(optionNames(listbox)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(label("slashHeading1")),
        expect.stringContaining(label("slashHeading")),
        expect.stringContaining(label("slashHeading3")),
        expect.stringContaining(label("slashDivider")),
      ]),
    );
    expect(label("slashHeading")).toBe("Heading 2");
    // No upload target, so the file command is not offered.
    expect(
      optionNames(listbox).some((name) => name.includes(label("slashFile"))),
    ).toBe(false);
    for (const option of options)
      expect(option).toHaveAttribute("tabindex", "-1");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    expect(within(listbox).getAllByRole("group").length).toBeGreaterThan(0);

    expect(dom).toHaveAttribute("aria-controls", listbox.id);
    expect(dom).toHaveAttribute("aria-activedescendant", options[0]?.id);

    await act(async () => {
      fireEvent.keyDown(dom, { key: "ArrowDown" });
    });
    await waitFor(() =>
      expect(dom).toHaveAttribute("aria-activedescendant", options[1]?.id),
    );
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      fireEvent.keyDown(dom, { key: "End" });
    });
    const last = options.at(-1);
    await waitFor(() =>
      expect(dom).toHaveAttribute("aria-activedescendant", last?.id),
    );

    await act(async () => {
      fireEvent.keyDown(dom, { key: "Home" });
    });
    await waitFor(() =>
      expect(dom).toHaveAttribute("aria-activedescendant", options[0]?.id),
    );

    await act(async () => {
      fireEvent.keyDown(dom, { key: "ArrowUp" });
    });
    await waitFor(() =>
      expect(dom).toHaveAttribute("aria-activedescendant", last?.id),
    );

    await act(async () => {
      fireEvent.keyDown(dom, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(dom).not.toHaveAttribute("aria-controls");
    expect(dom).not.toHaveAttribute("aria-activedescendant");
  });

  it("renders platform-aware shortcut hints from the real key bindings", async () => {
    expect(describeEditorShortcut(["Mod", "Alt", "2"], true)).toEqual({
      display: ["⌘", "⌥", "2"],
      aria: "Meta+Alt+2",
    });
    expect(describeEditorShortcut(["Mod", "Shift", "8"], false)).toEqual({
      display: ["Ctrl", "Shift", "8"],
      aria: "Control+Shift+8",
    });

    const { editor } = await renderEditor();
    const listbox = await openSlashMenu(editor);
    const heading2 = within(listbox).getByRole("option", {
      name: label("slashHeading"),
    });
    expect(heading2).toHaveAttribute(
      "aria-keyshortcuts",
      describeEditorShortcut(["Mod", "Alt", "2"]).aria,
    );
    const keys = Array.from(
      heading2.querySelectorAll('[data-slot="kbd"]'),
      (key) => key.textContent,
    );
    expect(keys).toEqual(describeEditorShortcut(["Mod", "Alt", "2"]).display);
    // The divider has no default binding, so it shows no hint.
    expect(
      within(listbox)
        .getByRole("option", { name: label("slashDivider") })
        .querySelector('[data-slot="kbd"]'),
    ).toBeNull();
  });

  it("filters by label and by search terms, and reports no matches", async () => {
    const { editor } = await renderEditor();
    let listbox = await openSlashMenu(editor, "/heading");
    expect(optionNames(listbox)).toEqual([
      expect.stringContaining(label("slashHeading1")),
      expect.stringContaining(label("slashHeading")),
      expect.stringContaining(label("slashHeading3")),
    ]);

    await act(async () => {
      editor.commands.clearContent();
    });
    listbox = await openSlashMenu(editor, "/hr");
    expect(optionNames(listbox)).toEqual([
      expect.stringContaining(label("slashDivider")),
    ]);

    await act(async () => {
      editor.commands.clearContent();
    });
    listbox = await openSlashMenu(editor, "/zzzz");
    expect(within(listbox).queryAllByRole("option")).toHaveLength(0);
    expect(listbox).toHaveTextContent(label("noCommands"));
  });

  it.each([
    ["slashHeading1", { type: "heading", attrs: { level: 1 } }],
    ["slashHeading", { type: "heading", attrs: { level: 2 } }],
    ["slashHeading3", { type: "heading", attrs: { level: 3 } }],
    ["slashDivider", { type: "horizontalRule" }],
  ])(
    "%s inserts the matching node and removes the slash",
    async (key, node) => {
      const { editor } = await renderEditor();
      const listbox = await openSlashMenu(editor);
      const option = within(listbox).getByRole("option", { name: label(key) });
      await act(async () => {
        fireEvent.mouseDown(option);
      });
      await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
      expect(topLevelNodes(editor)).toContainEqual(
        expect.objectContaining(node),
      );
      expect(editor.getText()).not.toContain("/");
    },
  );

  it("runs the selected command with Enter", async () => {
    const { dom, editor } = await renderEditor();
    await openSlashMenu(editor, "/h3");
    await act(async () => {
      fireEvent.keyDown(dom, { key: "Enter" });
    });
    await waitFor(() =>
      expect(topLevelNodes(editor)[0]).toMatchObject({
        type: "heading",
        attrs: { level: 3 },
      }),
    );
  });
});

describe("CommentEditor bubble menu", () => {
  it.each([
    ["bubbleStrike", (editor: Editor) => editor.isActive("strike")],
    ["bubbleCode", (editor: Editor) => editor.isActive("code")],
    [
      "bubbleHeading",
      (editor: Editor) => editor.isActive("heading", { level: 2 }),
    ],
    ["bubbleQuote", (editor: Editor) => editor.isActive("blockquote")],
  ])("%s toggles its format on the selection", async (key, isActive) => {
    const { editor } = await renderEditor();
    await act(async () => {
      editor.commands.insertContent("format me");
      editor.commands.setTextSelection({ from: 1, to: 7 });
    });
    const button = await waitFor(() =>
      screen.getByRole("button", { name: label(key), hidden: true }),
    );
    expect(button).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(isActive(editor)).toBe(true);
  });

  it("hides the attach button when the surface cannot store files", async () => {
    const { container, editor } = await renderEditor();
    await act(async () => {
      editor.commands.insertContent("no files here");
      editor.commands.setTextSelection({ from: 1, to: 3 });
    });
    await waitFor(() =>
      screen.getByRole("button", { name: label("bubbleStrike"), hidden: true }),
    );
    expect(
      container.ownerDocument.querySelector(
        ".taskdesk-comment-editor-bubble .lucide-paperclip",
      ),
    ).toBeNull();
  });
});

describe("CommentEditor Ctrl/⌘+K", () => {
  it("opens the link dialog for a selection without reaching the command palette", async () => {
    const palette = vi.fn();
    document.addEventListener("keydown", palette);
    try {
      const { dom, editor } = await renderEditor();
      await act(async () => {
        editor.commands.insertContent("link this");
        editor.commands.setTextSelection({ from: 1, to: 5 });
      });
      await act(async () => {
        fireEvent.keyDown(dom, { key: "k", ctrlKey: true });
      });
      expect(
        await screen.findByRole("dialog", { name: label("enterUrl") }),
      ).toBeInTheDocument();
      expect(palette).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", palette);
    }
  });

  it("leaves Ctrl/⌘+K to the command palette when there is nothing to link", async () => {
    const palette = vi.fn();
    document.addEventListener("keydown", palette);
    try {
      const { dom, editor } = await renderEditor();
      await act(async () => {
        editor.commands.insertContent("caret only");
      });
      await act(async () => {
        fireEvent.keyDown(dom, { key: "k", metaKey: true });
      });
      expect(palette).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      document.removeEventListener("keydown", palette);
    }
  });
});

describe("CommentEditor Markdown paste", () => {
  const clipboard = (text: string, html = "") => ({
    clipboardData: {
      files: [],
      types: html ? ["text/plain", "text/html"] : ["text/plain"],
      getData: (type: string) =>
        type === "text/plain" ? text : type === "text/html" ? html : "",
    },
  });

  it("turns plain-text Markdown into structure", async () => {
    const { dom, editor } = await renderEditor();
    await act(async () => {
      fireEvent.paste(dom, clipboard("# Plan\n\n- first\n- second\n\n---"));
    });
    await waitFor(() =>
      expect(topLevelNodes(editor).map((node) => node.type)).toEqual(
        expect.arrayContaining(["heading", "bulletList", "horizontalRule"]),
      ),
    );
    expect(topLevelNodes(editor)[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
    });
  });

  it("keeps plain prose, rich HTML and Ctrl/⌘+Shift+V pastes out of the Markdown parser", async () => {
    const { dom, editor } = await renderEditor();
    await act(async () => {
      fireEvent.paste(dom, clipboard("Just a sentence - nothing more."));
    });
    await act(async () => {
      fireEvent.paste(dom, clipboard("# From a page", "<p># From a page</p>"));
    });
    await act(async () => {
      fireEvent.keyDown(dom, { key: "V", ctrlKey: true, shiftKey: true });
      fireEvent.paste(dom, clipboard("## Plain please"));
    });
    expect(topLevelNodes(editor).some((node) => node.type === "heading")).toBe(
      false,
    );
    expect(editor.getText()).toContain("## Plain please");

    // The plain-paste request covers one paste only.
    await act(async () => {
      fireEvent.paste(dom, clipboard("## Structured again"));
    });
    await waitFor(() =>
      expect(
        topLevelNodes(editor).some((node) => node.type === "heading"),
      ).toBe(true),
    );
  });

  it("leaves code blocks literal", async () => {
    const { dom, editor } = await renderEditor();
    await act(async () => {
      editor.commands.setCodeBlock();
    });
    await act(async () => {
      fireEvent.paste(dom, clipboard("# not a heading"));
    });
    expect(topLevelNodes(editor).some((node) => node.type === "heading")).toBe(
      false,
    );
  });
});

describe("CommentEditor embeds", () => {
  it("keeps a pasted video as a link when embeds are off", async () => {
    const { dom, editor } = await renderEditor({ allowEmbeds: false });
    await act(async () => {
      fireEvent.paste(dom, {
        clipboardData: {
          files: [],
          types: ["text/plain"],
          getData: (type: string) =>
            type === "text/plain"
              ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              : "",
        },
      });
    });
    expect(screen.queryByText(label("embedVideo"))).toBeNull();
    expect(editor.getText()).toContain("youtube.com");
  });

  it("still offers the embed composer by default", async () => {
    const { dom } = await renderEditor();
    await act(async () => {
      fireEvent.paste(dom, {
        clipboardData: {
          files: [],
          types: ["text/plain"],
          getData: (type: string) =>
            type === "text/plain"
              ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              : "",
        },
      });
    });
    expect(await screen.findByText(label("embedVideo"))).toBeInTheDocument();
  });
});

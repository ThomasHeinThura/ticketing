import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
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

import {
  createKbOnlySlashCommands,
  KB_EDITOR_EXTENSIONS,
} from "@/components/kb/agent/kb-editor-extensions";
import { DocumentEditor } from "./document-editor";

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 1));
});

const label = (key: string) => translate(`activity:comment.editor.${key}`);
const body = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Saved" }] }],
};
const kbOnly = createKbOnlySlashCommands({
  internalCallout: "Internal note",
  internalCalloutSearch: "internal",
  workItemReference: "Work item reference",
  workItemReferenceSearch: "reference",
});

async function mount(props: Partial<Parameters<typeof DocumentEditor>[0]>) {
  const onDocumentChange = vi.fn();
  const view = render(
    <DocumentEditor
      ariaLabel="Page body"
      documentValue={body}
      onDocumentChange={onDocumentChange}
      {...props}
    />,
  );
  const dom = await waitFor(() => {
    const element = view.container.querySelector<
      HTMLElement & { editor?: Editor }
    >('.ProseMirror[contenteditable="true"]');
    expect(element?.editor).toBeDefined();
    return element as HTMLElement & { editor: Editor };
  });
  await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  return { ...view, dom, editor: dom.editor, onDocumentChange };
}

async function slashOptions(editor: Editor) {
  await act(async () => {
    editor.commands.insertContent(" /");
  });
  const listbox = await waitFor(() =>
    screen.getByRole("listbox", { name: label("slashMenuLabel") }),
  );
  return within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

describe("DocumentEditor", () => {
  it("applies document styling without dropping the shared prose rules", async () => {
    const { container, dom } = await mount({});
    expect(
      container.querySelector(".taskdesk-document-editor-content"),
    ).not.toBeNull();
    expect(dom).toHaveClass("taskdesk-comment-editor-prose");
    expect(dom).toHaveClass("taskdesk-document-prose");
    expect(
      screen.getByRole("region", { name: "Page body" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: translate("activity:comment.attachFile"),
      }),
    ).toBeNull();
  });

  it("reports edits only after the person interacts", async () => {
    const { dom, editor, onDocumentChange } = await mount({});
    await act(async () => {
      editor.commands.insertContent(" programmatic");
    });
    expect(onDocumentChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(dom, { key: "a" });
      editor.commands.insertContent(" typed");
    });
    await waitFor(() =>
      expect(onDocumentChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "doc" }),
      ),
    );
    expect(JSON.stringify(onDocumentChange.mock.calls.at(-1)?.[0])).toContain(
      "typed",
    );
  });

  it("reports a blur only when focus leaves the editor, not when it moves inside it", async () => {
    const onBlur = vi.fn();
    const { container, dom } = await mount({ onBlur });
    const shell = container.querySelector(".taskdesk-document-editor");
    const inside = shell?.querySelector(".taskdesk-comment-editor-content");
    fireEvent.blur(dom, { relatedTarget: inside });
    expect(onBlur).not.toHaveBeenCalled();
    fireEvent.blur(dom, { relatedTarget: document.body });
    expect(onBlur).toHaveBeenCalledTimes(1);
    fireEvent.blur(dom, { relatedTarget: null });
    expect(onBlur).toHaveBeenCalledTimes(2);
  });

  it("offers the info callout but not files, KB-only actions or embeds", async () => {
    const { editor } = await mount({});
    const options = await slashOptions(editor);
    expect(options).toContainEqual(
      expect.stringContaining(label("slashCallout")),
    );
    expect(options.some((name) => name.includes(label("slashFile")))).toBe(
      false,
    );
    expect(options.some((name) => name.includes("Internal note"))).toBe(false);
  });

  it("adds caller-owned KB actions without duplicating the callout node", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { editor } = await mount({
        additionalExtensions: KB_EDITOR_EXTENSIONS,
        additionalSlashCommands: kbOnly,
      });
      const options = await slashOptions(editor);
      expect(
        options.filter((name) => name.includes(label("slashCallout"))),
      ).toHaveLength(1);
      expect(options).toContainEqual(expect.stringContaining("Internal note"));
      expect(options).toContainEqual(
        expect.stringContaining("Work item reference"),
      );
      expect(
        warn.mock.calls.some((call) => String(call[0]).includes("Duplicate")),
      ).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

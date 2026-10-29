import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createInstance } from "i18next";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorLinkDialog } from "./editor-link-dialog";

const editors: Editor[] = [];
const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: "en",
    resources: {
      en: {
        common: { actions: { close: "Close", cancel: "Cancel", save: "Save" } },
      },
    },
  });
});

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

function openLinkDialog({
  content = "<p>Selected words</p>",
  initialUrl = "",
  editable = true,
} = {}) {
  const editor = new Editor({
    extensions: [StarterKit],
    content,
  });
  editors.push(editor);
  editor.commands.setTextSelection({ from: 1, to: 9 });
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <EditorContent editor={editor} />
        {open && (
          <EditorLinkDialog
            editor={editor}
            editable={editable}
            initialUrl={initialUrl}
            label="Enter URL"
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  return editor;
}

describe("editor link dialog", () => {
  it("names and focuses the library input, then links the retained selection", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const editor = openLinkDialog();
    const input = await screen.findByRole("textbox", { name: "Enter URL" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "https://example.test/docs" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(editor.getHTML()).toContain('href="https://example.test/docs"');
    expect(editor.getHTML()).toContain(">Selected</a> words");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("cancels on Escape without changing the document and restores editor focus", async () => {
    const editor = openLinkDialog();
    const before = editor.getJSON();
    const input = await screen.findByRole("textbox", { name: "Enter URL" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, {
      target: { value: "https://example.test/cancel" },
    });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(editor.getJSON()).toEqual(before);
    await waitFor(() => expect(editor.view.dom).toHaveFocus());
  });

  it("keeps blank submission as remove-link, including the existing link range", async () => {
    const editor = openLinkDialog({
      content: '<p><a href="https://example.test/old">Selected words</a></p>',
      initialUrl: "https://example.test/old",
    });
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Enter URL" }),
      {
        target: { value: "  " },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(editor.getHTML()).not.toContain("<a"));
    expect(editor.getText()).toBe("Selected words");
  });

  it("retains the editor extension's rejection of unsafe links", async () => {
    const editor = openLinkDialog();
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Enter URL" }),
      {
        target: { value: "javascript:alert(1)" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(editor.getHTML()).not.toContain("javascript:");
    expect(editor.getText()).toBe("Selected words");
  });

  it("refuses a pending edit when the editor becomes read-only", async () => {
    const editor = openLinkDialog();
    const input = await screen.findByRole("textbox", { name: "Enter URL" });
    fireEvent.change(input, {
      target: { value: "https://example.test/denied" },
    });
    await act(async () => editor.setEditable(false));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(editor.getHTML()).not.toContain("<a");
  });
});

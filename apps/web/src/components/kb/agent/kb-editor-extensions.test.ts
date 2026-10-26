import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { createKbSlashCommands, KbCallout } from "./kb-editor-extensions";

const labels = {
  callout: "Callout",
  calloutSearch: "callout info note",
  internalCallout: "Internal note",
  internalCalloutSearch: "callout internal private",
  workItemReference: "Work item reference",
  workItemReferenceSearch: "work item issue key",
};

describe("KB article editor extensions", () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  function makeEditor() {
    editor = new Editor({
      extensions: [StarterKit, KbCallout],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    return editor;
  }

  it("inserts an info callout in the persisted KB node shape", () => {
    const activeEditor = makeEditor();
    const callout = createKbSlashCommands(labels).find(
      (command) => command.id === "kb-callout",
    );

    expect(callout).toBeDefined();
    callout?.run(activeEditor, { from: 1, to: 1 });

    expect(activeEditor.getJSON().content).toEqual([
      {
        type: "callout",
        attrs: { variant: "info" },
        content: [{ type: "paragraph" }],
      },
      { type: "paragraph" },
    ]);
  });

  it("inserts internal callouts and starts work-item reference entry", () => {
    const activeEditor = makeEditor();
    const commands = createKbSlashCommands(labels);
    commands
      .find((command) => command.id === "kb-internal-callout")
      ?.run(activeEditor, { from: 1, to: 1 });

    expect(activeEditor.getJSON().content?.[0]).toMatchObject({
      type: "callout",
      attrs: { variant: "internal" },
    });

    const referenceEditor = new Editor({ extensions: [StarterKit] });
    try {
      commands
        .find((command) => command.id === "kb-work-item-reference")
        ?.run(referenceEditor, { from: 1, to: 1 });
      expect(referenceEditor.getText()).toBe("#");
    } finally {
      referenceEditor.destroy();
    }
  });
});

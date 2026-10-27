import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import CommentEditor from "@/components/activity/comment-editor";
import {
  createKbSlashCommands,
  KB_EDITOR_EXTENSIONS,
} from "./kb-editor-extensions";

const body = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Before you start" }],
    },
    {
      type: "callout",
      attrs: { variant: "internal" },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Agents only" }],
        },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Open the sign-in page." }],
    },
  ],
};

// A new translation function (the `kb` namespace finishing its lazy load) yields
// new slash-command labels, so the editor receives a fresh array identity.
const slashCommands = (suffix: string) =>
  createKbSlashCommands({
    callout: `Callout${suffix}`,
    calloutSearch: "callout",
    internalCallout: `Internal${suffix}`,
    internalCalloutSearch: "internal",
    workItemReference: `Reference${suffix}`,
    workItemReferenceSearch: "reference",
  });

// The labels change while the editor is still delivering its first instance: the
// `kb` namespace finishes loading right after the article editor mounts.
function ArticleBody() {
  const [commands, setCommands] = useState(() => slashCommands(""));
  useEffect(() => {
    setCommands(slashCommands(" (translated)"));
  }, []);
  return (
    <CommentEditor
      ariaLabel="Article body"
      value=""
      documentValue={body}
      enableMentions={false}
      showQuickAttachButton={false}
      placeholder="Write the article"
      additionalExtensions={KB_EDITOR_EXTENSIONS}
      additionalSlashCommands={commands}
    />
  );
}

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await new Promise((resolve) => setTimeout(resolve, 1));
});

describe("KB article body editor", () => {
  it("settles on one live editor when its options change while the first instance is delivered", async () => {
    const destroy = vi.spyOn(Editor.prototype, "destroy");
    const { container } = render(
      <StrictMode>
        <ArticleBody />
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // One option change replaces the editor once; the dispose/recreate cycle behind
    // "Maximum update depth exceeded" destroyed a fresh editor on every render.
    expect(destroy.mock.calls.length).toBeLessThanOrEqual(3);
    const surface = await waitFor(() => {
      const element = container.querySelector(".ProseMirror");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(surface.getAttribute("contenteditable")).toBe("true");
    expect(surface.textContent).toContain("Agents only");
    expect(surface.textContent).toContain("Open the sign-in page.");
  });
});

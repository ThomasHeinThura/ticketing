vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const mocks = vi.hoisted(() => ({
  getWorkItem: vi.fn(),
  getTask: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("@/fetchers/task/get-task", () => ({ default: mocks.getTask }));
vi.mock("@/fetchers/project/get-project", () => ({
  default: mocks.getProject,
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: mocks.getWorkItem,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractWorkItemKeyFromUrl,
  WorkItemIssueLink,
} from "./work-item-issue-link";

let captured: ReturnType<typeof useEditor> | null = null;
function Host({ content }: { content?: unknown }) {
  const editor = useEditor({
    extensions: [StarterKit, WorkItemIssueLink],
    content: (content ?? "") as string,
  });
  captured = editor;
  return <EditorContent editor={editor} />;
}
function mount(content?: unknown) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Host content={content} />
    </QueryClientProvider>,
  );
}
const linkDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "taskdeskIssueLink",
          attrs: { url: "/agent/work-items/OPS-17", issueKey: "OPS-17" },
        },
      ],
    },
  ],
};

beforeEach(() => {
  mocks.getWorkItem.mockReset();
  mocks.getTask.mockReset();
  mocks.getProject.mockReset();
});
afterEach(cleanup);

describe("CA-14 work item links in comments", () => {
  it("recognises a canonical work-item URL and nothing else", () => {
    expect(
      extractWorkItemKeyFromUrl("https://desk.example/agent/work-items/ops-17"),
    ).toBe("OPS-17");
    expect(
      extractWorkItemKeyFromUrl(
        "https://desk.example/agent/work-items/OPS-17?activity=comments",
      ),
    ).toBe("OPS-17");
    expect(
      extractWorkItemKeyFromUrl(
        "https://desk.example/dashboard/workspace/w/project/p/task/abc",
      ),
    ).toBeNull();
    expect(extractWorkItemKeyFromUrl("not a url")).toBeNull();
  });

  it("renders the key, title and state of the canonical work item, linking to its /agent page", async () => {
    mocks.getWorkItem.mockResolvedValue({
      key: "OPS-17",
      title: "Printer jams",
      stateName: "In progress",
      priority: "high",
      assigneeName: null,
    });
    mount(linkDoc);
    const link = await screen.findByRole("link");
    await waitFor(() => expect(link).toHaveTextContent("Printer jams"));
    expect(link).toHaveTextContent("OPS-17");
    expect(link).toHaveTextContent("In progress");
    expect(link.getAttribute("href")).toBe("/agent/work-items/OPS-17");
    expect(mocks.getWorkItem).toHaveBeenCalledWith("OPS-17");
  });

  it("shows only the key, with no link and no title, for an item the viewer cannot read", async () => {
    mocks.getWorkItem.mockRejectedValue(new Error("404"));
    mount(linkDoc);
    await waitFor(() => expect(screen.getByText("OPS-17")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("…")).toBeNull());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps Kaneo's link view for a legacy node that has only a task id and URL", async () => {
    mocks.getTask.mockResolvedValue({
      id: "t1",
      title: "Legacy task",
      number: 4,
      status: "to-do",
      priority: "high",
      assigneeName: null,
    });
    mocks.getProject.mockResolvedValue({ slug: "pro" });
    mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "taskdeskIssueLink",
              attrs: {
                url: "/dashboard/workspace/w/project/p/task/t1",
                taskId: "t1",
              },
            },
          ],
        },
      ],
    });
    const link = await screen.findByRole("link");
    await waitFor(() => expect(link).toHaveTextContent("Legacy task"));
    expect(link.getAttribute("href")).toBe(
      "/dashboard/workspace/w/project/p/task/t1",
    );
    // Never queried as a work item: there is no key to resolve.
    expect(mocks.getWorkItem).not.toHaveBeenCalled();
  });

  it("keeps a plain link to the stored URL for a legacy node that has only a URL", async () => {
    mocks.getTask.mockResolvedValue(undefined);
    mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "taskdeskIssueLink",
              attrs: { url: "https://old.example/dashboard/task/x" },
            },
          ],
        },
      ],
    });
    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe(
      "https://old.example/dashboard/task/x",
    );
  });

  it("turns #KEY followed by a space into a link node to the canonical route", () => {
    mount();
    const editor = captured;
    expect(editor).not.toBeNull();
    if (!editor) return;
    editor.commands.insertContent("see #sup-123");
    const { from, to } = editor.state.selection;
    editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, " ", () => editor.state.tr),
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"type":"taskdeskIssueLink"');
    expect(json).toContain('"issueKey":"SUP-123"');
    expect(json).toContain("/agent/work-items/SUP-123");
    expect(json).not.toContain("/dashboard/");
  });
});

import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import {
  type PropsWithChildren,
  StrictMode,
  useEffect,
  useRef,
  useState,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditorProps } from "@/components/editor/document-editor";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  editorMounts: vi.fn(),
  editor: { current: null as DocumentEditorProps | null },
  /** Types a paragraph at the end of what this editor instance holds, like a person would. */
  type: { current: (_text: string) => {} },
}));

vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  )),
  Link: ({ children, to }: PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
  useBlocker: () => ({ status: "idle" }),
}));
vi.mock("react-i18next", async () => {
  // One stable translation object, as react-i18next returns between renders.
  const translation = {
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
    i18n: { language: "en-US", resolvedLanguage: "en-US" },
  };
  return {
    ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
    useTranslation: () => translation,
  };
});
// The article screen's autosave is tested against a recording editor that, like the real one,
// loads `documentValue` when it mounts and then keeps its own content; the real editor's
// behaviour is covered below and in document-editor.test.tsx.
vi.mock("@/components/editor/document-editor", () => ({
  DocumentEditor: (props: DocumentEditorProps) => {
    mocks.editor.current = props;
    const content = useRef(props.documentValue as { content?: unknown[] });
    mocks.type.current = (text: string) => {
      content.current = {
        type: "doc",
        content: [
          ...(content.current.content ?? []),
          { type: "paragraph", content: [{ type: "text", text }] },
        ],
      } as { content?: unknown[] };
      props.onDocumentChange(content.current);
    };
    useEffect(() => {
      mocks.editorMounts();
    }, []);
    return <div data-testid="document-editor" />;
  },
}));
vi.mock("@/fetchers/kb", async () => ({
  ...(await vi.importActual<typeof import("@/fetchers/kb")>("@/fetchers/kb")),
  updateKbArticle: mocks.update,
}));
vi.mock("@/hooks/queries/kb", () => ({
  kbKeys: {
    all: (workspaceId: string) => ["kb", workspaceId],
    article: (id: string) => ["kb", "article", id],
    versions: (id: string) => ["kb", "article", id, "versions"],
  },
  useKbArticle: () => ({
    data: { article: kbArticle, canWrite: true, canPublish: false },
  }),
  useKbCategories: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
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

import CommentEditor from "@/components/activity/comment-editor";
import { KbVersionConflictError } from "@/fetchers/kb";
import { DOCUMENT_AUTOSAVE_DELAY_MS } from "@/hooks/use-document-autosave";
import { KbArticleEditor } from "./kb-article-editor";
import {
  createKbSlashCommands,
  KB_EDITOR_EXTENSIONS,
} from "./kb-editor-extensions";

const kbArticle = {
  id: "qa-article",
  workspaceId: "qa-workspace",
  title: "Reset a password",
  body: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Step one" }] },
    ],
  },
  categoryId: null,
  projectId: null,
  customerVisible: false,
  ownerId: null,
  reviewDueAt: null,
  version: 7,
  state: "draft",
};

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.update.mockReset();
  mocks.editorMounts.mockReset();
  mocks.editor.current = null;
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

const editedBody = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Step two" }] },
  ],
};

const paragraphs = (...texts: string[]) => ({
  type: "doc",
  content: texts.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

function renderArticleEditor() {
  const cache = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidated: QueryKey[] = [];
  const invalidate = cache.invalidateQueries.bind(cache);
  vi.spyOn(cache, "invalidateQueries").mockImplementation((filters) => {
    if (filters?.queryKey) invalidated.push(filters.queryKey);
    return invalidate(filters);
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <KbArticleEditor id={kbArticle.id} search={{}} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...view, invalidated };
}

async function afterAutosaveDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS);
  });
}

describe("KB article editor autosave", () => {
  it("edits inline with no Save button and the reference hint below the editor box", () => {
    renderArticleEditor();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      kbArticle.title,
    );
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    const hint = screen.getByText(/type a key such as OPS-123/);
    expect(hint.getAttribute("data-slot")).toBe("field-description");
    expect(
      within(screen.getByTestId("document-editor")).queryByText(/OPS-123/),
    ).toBeNull();
  });

  it("saves the body on the returned version without remounting the editor, and refreshes the history", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.update.mockImplementation(async (_id, version: number, changes) => ({
      ...kbArticle,
      ...changes,
      version: version + 1,
    }));
    const { invalidated } = renderArticleEditor();
    const loaded = mocks.editor.current?.documentValue;

    act(() => mocks.editor.current?.onDocumentChange(editedBody));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("qa-article", 7, {
      body: editedBody,
    });
    await screen.findByText("All changes saved");
    expect(invalidated).toContainEqual([
      "kb",
      "article",
      "qa-article",
      "versions",
    ]);

    const again = { ...editedBody };
    act(() => mocks.editor.current?.onDocumentChange(again));
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenLastCalledWith("qa-article", 8, {
      body: again,
    });
    expect(mocks.editorMounts).toHaveBeenCalledTimes(1);
    expect(mocks.editor.current?.documentValue).toBe(loaded);
  });

  it("keeps focus and the typed title while the title saves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const typed = { current: "" };
    mocks.update.mockImplementation(async (_id, version: number, changes) => {
      // The person keeps typing while the save is in flight.
      fireEvent.change(title, { target: { value: typed.current } });
      return { ...kbArticle, ...changes, version: version + 1 };
    });
    renderArticleEditor();
    const title = screen.getByRole("textbox", { name: "Title" });
    title.focus();
    fireEvent.change(title, { target: { value: "Reset a password fast" } });
    typed.current = "Reset a password faster";
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenNthCalledWith(1, "qa-article", 7, {
      title: "Reset a password fast",
    });
    expect(title).toHaveValue("Reset a password faster");
    expect(document.activeElement).toBe(title);
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenLastCalledWith("qa-article", 8, {
      title: "Reset a password faster",
    });
  });

  it("opens the existing conflict dialog on a 409 and does not retry by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const theirs = {
      ...kbArticle,
      title: "Reset a password (theirs)",
      version: 9,
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Theirs" }] },
        ],
      },
    };
    mocks.update.mockRejectedValue(
      new KbVersionConflictError(
        theirs as unknown as ConstructorParameters<
          typeof KbVersionConflictError
        >[0],
      ),
    );
    renderArticleEditor();
    act(() => mocks.editor.current?.onDocumentChange(editedBody));
    await afterAutosaveDelay();
    expect(await screen.findByText("Someone else saved first")).toBeTruthy();
    expect(screen.getByText("Autosave paused")).toBeInTheDocument();
    await afterAutosaveDelay();
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Use the saved version" }),
    );
    await waitFor(() => expect(mocks.editorMounts).toHaveBeenCalledTimes(2));
    expect(mocks.editor.current?.documentValue).toEqual(theirs.body);
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      theirs.title,
    );
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("keeps the editor and its edits across the customer preview, so the next edit saves on top of them", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.update.mockImplementation(async (_id, version: number, changes) => ({
      ...kbArticle,
      ...changes,
      version: version + 1,
    }));
    const cache = new QueryClient();
    const screenAt = (search: { preview?: true }) => (
      <QueryClientProvider client={cache}>
        <KbArticleEditor
          id={kbArticle.id}
          search={search}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>
    );
    const view = render(screenAt({}));

    act(() => mocks.type.current("First edit"));
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenLastCalledWith("qa-article", 7, {
      body: paragraphs("Step one", "First edit"),
    });

    view.rerender(screenAt({ preview: true }));
    expect(screen.getByText("First edit")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    view.rerender(screenAt({}));
    expect(screen.getByRole("textbox", { name: "Title" })).toBeVisible();

    act(() => mocks.type.current("Second edit"));
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenLastCalledWith("qa-article", 8, {
      body: paragraphs("Step one", "First edit", "Second edit"),
    });
  });

  it("keeps only the fields this person changed when they keep their version after a conflict", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const theirs = {
      ...kbArticle,
      title: "Reset a password",
      categoryId: "their-category",
      version: 9,
      body: paragraphs("Their body"),
    };
    mocks.update
      .mockRejectedValueOnce(
        new KbVersionConflictError(
          theirs as unknown as ConstructorParameters<
            typeof KbVersionConflictError
          >[0],
        ),
      )
      .mockImplementation(async (_id, version: number, changes) => ({
        ...theirs,
        ...changes,
        version: version + 1,
      }));
    renderArticleEditor();
    // Only the title changes; the body and the category stay as loaded.
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Reset a password quickly" },
    });
    await afterAutosaveDelay();
    expect(await screen.findByText("Someone else saved first")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update).toHaveBeenLastCalledWith("qa-article", 9, {
      title: "Reset a password quickly",
    });
    // The untouched body now shows (and later edits build on) the saved version.
    await waitFor(() => expect(mocks.editorMounts).toHaveBeenCalledTimes(2));
    expect(mocks.editor.current?.documentValue).toEqual(theirs.body);
    await screen.findByText("All changes saved");
    act(() => mocks.type.current("Mine on theirs"));
    await afterAutosaveDelay();
    expect(mocks.update).toHaveBeenLastCalledWith("qa-article", 10, {
      body: paragraphs("Their body", "Mine on theirs"),
    });
  });
});

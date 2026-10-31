import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditorProps } from "@/components/editor/document-editor";
import type { Page } from "@/fetchers/pages";

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  getPages: vi.fn(),
  getPageVersions: vi.fn(),
  getPageVersion: vi.fn(),
  savePage: vi.fn(),
  requestPageDeletion: vi.fn(),
  open: vi.fn(),
  editorMounts: vi.fn(),
  editor: { current: null as DocumentEditorProps | null },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  useBlocker: () => ({ status: "idle" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
// The real editor is covered by document-editor.test.tsx; this one records its props and mounts.
vi.mock("@/components/editor/document-editor", () => ({
  DocumentEditor: (props: DocumentEditorProps) => {
    mocks.editor.current = props;
    useEffect(() => {
      mocks.editorMounts();
    }, []);
    return <div data-testid="editor" />;
  },
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.open,
}));
vi.mock("@/fetchers/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/pages")>()),
  getPage: (...args: unknown[]) => mocks.getPage(...args),
  getPages: (...args: unknown[]) => mocks.getPages(...args),
  getPageVersions: (...args: unknown[]) => mocks.getPageVersions(...args),
  getPageVersion: (...args: unknown[]) => mocks.getPageVersion(...args),
  savePage: (...args: unknown[]) => mocks.savePage(...args),
  requestPageDeletion: (...args: unknown[]) =>
    mocks.requestPageDeletion(...args),
}));

import { PageConflictError } from "@/fetchers/pages";
import { DOCUMENT_AUTOSAVE_DELAY_MS } from "@/hooks/use-document-autosave";
import { HttpError } from "@/lib/http-error";
import { PageDetail } from "./page-detail";

function pageOf(canEdit: boolean): Page {
  return {
    id: "pg1",
    projectId: "p1",
    parentId: null,
    title: "Runbook",
    snippet: "",
    version: 2,
    updatedBy: { id: "u1", name: "Ada" },
    createdBy: { id: "u1", name: "Ada" },
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Step one" }] },
      ],
    },
    canEdit,
  };
}

function renderDetail() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PageDetail projectKey="HELP" pageId="pg1" />
    </QueryClientProvider>,
  );
}

function setup(canEdit: boolean) {
  mocks.getPage.mockResolvedValue(pageOf(canEdit));
  mocks.getPages.mockResolvedValue({ canEdit, pages: [] });
  mocks.getPageVersions.mockResolvedValue({
    versions: [
      {
        number: 2,
        title: "Runbook",
        kind: "edit",
        restoredFrom: null,
        createdBy: { id: "u1", name: "Ada" },
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
      },
      {
        number: 1,
        title: "Runbook",
        kind: "create",
        restoredFrom: null,
        createdBy: { id: "u1", name: "Ada" },
        createdAt: "2026-10-23T00:00:00.000Z",
        updatedAt: "2026-10-23T00:00:00.000Z",
      },
    ],
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const mock of Object.values(mocks))
    if (typeof mock === "function") mock.mockReset();
  mocks.editor.current = null;
});

const editedBody = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Step two" }] },
  ],
};

/** Fake timers that still let React Query and the DOM settle in real time. */
async function afterAutosaveDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS);
  });
}

function editBody(document: unknown = editedBody) {
  act(() => mocks.editor.current?.onDocumentChange(document));
}

describe("PageDetail", () => {
  it("renders the body and the version history, marking the current version", async () => {
    setup(false);
    renderDetail();
    expect(await screen.findByText("Step one")).toBeTruthy();
    expect(
      await screen.findByText(/history.version .*"number":2/),
    ).toBeTruthy();
    expect(screen.getByText("history.current")).toBeTruthy();
    expect(screen.getAllByText("history.view")).toHaveLength(2);
  });

  it("shows the read-only page, without editing or delete, to a caller who cannot edit", async () => {
    setup(false);
    renderDetail();
    await screen.findByText("Step one");
    expect(screen.getByRole("heading", { name: "Runbook" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "fields.title" })).toBeNull();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByText("delete.action")).toBeNull();
  });

  it("edits inline for a caller who can edit: title and body, no Edit or Save button", async () => {
    setup(true);
    renderDetail();
    const title = await screen.findByRole("textbox", { name: "fields.title" });
    expect((title as HTMLTextAreaElement).value).toBe("Runbook");
    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(mocks.editor.current?.documentValue).toEqual(pageOf(true).body);
    expect(screen.getByText("editor.saved")).toBeTruthy();
    expect(screen.queryByText("detail.edit")).toBeNull();
    expect(screen.queryByText("editor.save")).toBeNull();
  });

  it("autosaves the body on the returned version without remounting the editor, and refetches the history", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(true);
    mocks.savePage.mockImplementation(
      async (_key, _id, version: number, changes) => ({
        ...pageOf(true),
        version: version + 1,
        body: changes.body ?? pageOf(true).body,
      }),
    );
    renderDetail();
    await screen.findByTestId("editor");
    const versionCalls = mocks.getPageVersions.mock.calls.length;
    const initialDocument = mocks.editor.current?.documentValue;

    editBody();
    expect(screen.getByText("editor.unsaved")).toBeTruthy();
    await afterAutosaveDelay();
    expect(mocks.savePage).toHaveBeenCalledExactlyOnceWith("HELP", "pg1", 2, {
      body: editedBody,
    });
    await screen.findByText("editor.saved");
    await waitFor(() =>
      expect(mocks.getPageVersions.mock.calls.length).toBeGreaterThan(
        versionCalls,
      ),
    );

    editBody({ ...editedBody });
    await afterAutosaveDelay();
    expect(mocks.savePage).toHaveBeenLastCalledWith("HELP", "pg1", 3, {
      body: { ...editedBody },
    });
    expect(mocks.editorMounts).toHaveBeenCalledTimes(1);
    // The saved body is never written back into the editor.
    expect(mocks.editor.current?.documentValue).toBe(initialDocument);
  });

  it("keeps focus in the title while it autosaves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(true);
    mocks.savePage.mockImplementation(async (_key, _id, version: number) => ({
      ...pageOf(true),
      title: "Runbook v2",
      version: version + 1,
    }));
    renderDetail();
    const title = await screen.findByRole("textbox", { name: "fields.title" });
    title.focus();
    fireEvent.change(title, { target: { value: "Runbook v2" } });
    await afterAutosaveDelay();
    expect(mocks.savePage).toHaveBeenCalledExactlyOnceWith("HELP", "pg1", 2, {
      title: "Runbook v2",
    });
    await screen.findByText("editor.saved");
    expect(document.activeElement).toBe(title);
    expect(mocks.editorMounts).toHaveBeenCalledTimes(1);
  });

  it("opens the conflict dialog on a 409 and does not retry by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(true);
    mocks.savePage.mockRejectedValue(
      new PageConflictError({
        currentVersion: 5,
        currentTitle: "Runbook",
        updatedBy: { id: "u2", name: "Grace" },
        updatedAt: "2026-10-25T00:00:00.000Z",
      }),
    );
    renderDetail();
    await screen.findByTestId("editor");
    editBody();
    await afterAutosaveDelay();
    expect(await screen.findByText("conflict.title")).toBeTruthy();
    expect(screen.getByText("editor.autosavePaused")).toBeTruthy();
    editBody({ ...editedBody });
    await afterAutosaveDelay();
    await afterAutosaveDelay();
    expect(mocks.savePage).toHaveBeenCalledTimes(1);

    // Overwrite chains on the server's current version.
    mocks.savePage.mockResolvedValueOnce({ ...pageOf(true), version: 6 });
    fireEvent.click(screen.getByText("conflict.overwrite"));
    await waitFor(() =>
      expect(mocks.savePage).toHaveBeenLastCalledWith("HELP", "pg1", 5, {
        body: { ...editedBody },
      }),
    );
  });

  it("explains a history version that autosave merged into a later one", async () => {
    setup(true);
    mocks.getPageVersion.mockRejectedValue(new HttpError(404, "Not found"));
    renderDetail();
    const [, older] = await screen.findAllByText("history.view");
    const versionCalls = mocks.getPageVersions.mock.calls.length;
    fireEvent.click(older as HTMLElement);
    expect(await screen.findByText("history.versionMoved")).toBeTruthy();
    await waitFor(() =>
      expect(mocks.getPageVersions.mock.calls.length).toBeGreaterThan(
        versionCalls,
      ),
    );
  });

  it("requests deletion as a pending action instead of deleting directly", async () => {
    setup(true);
    mocks.requestPageDeletion.mockResolvedValue({ pendingActionId: "pa1" });
    renderDetail();
    fireEvent.click(await screen.findByText("delete.action"));
    fireEvent.click(await screen.findByText("delete.confirm"));
    await vi.waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ pendingActionId: "pa1" }),
    );
    expect(mocks.requestPageDeletion).toHaveBeenCalledWith("HELP", "pg1");
  });

  it("shows one not-found message for a missing page", async () => {
    mocks.getPage.mockRejectedValue(new HttpError(404, "Not found"));
    mocks.getPages.mockResolvedValue({ canEdit: false, pages: [] });
    renderDetail();
    expect(await screen.findByText("detail.notFoundTitle")).toBeTruthy();
  });
});

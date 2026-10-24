import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@/fetchers/pages";

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  getPages: vi.fn(),
  getPageVersions: vi.fn(),
  requestPageDeletion: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/activity/comment-editor", () => ({
  default: () => <div data-testid="editor" />,
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.open,
}));
vi.mock("@/fetchers/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/pages")>()),
  getPage: (...args: unknown[]) => mocks.getPage(...args),
  getPages: (...args: unknown[]) => mocks.getPages(...args),
  getPageVersions: (...args: unknown[]) => mocks.getPageVersions(...args),
  requestPageDeletion: (...args: unknown[]) =>
    mocks.requestPageDeletion(...args),
}));

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
      },
      {
        number: 1,
        title: "Runbook",
        kind: "create",
        restoredFrom: null,
        createdBy: { id: "u1", name: "Ada" },
        createdAt: "2026-10-23T00:00:00.000Z",
      },
    ],
  });
}

afterEach(() => {
  cleanup();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("PageDetail", () => {
  it("renders the body and the version history, marking the current version", async () => {
    setup(true);
    renderDetail();
    expect(await screen.findByText("Step one")).toBeTruthy();
    expect(
      await screen.findByText(/history.version .*"number":2/),
    ).toBeTruthy();
    expect(screen.getByText("history.current")).toBeTruthy();
    expect(screen.getAllByText("history.view")).toHaveLength(2);
  });

  it("offers edit and delete only to a caller who can edit", async () => {
    setup(false);
    renderDetail();
    await screen.findByText("Step one");
    expect(screen.queryByText("detail.edit")).toBeNull();
    expect(screen.queryByText("delete.action")).toBeNull();
  });

  it("opens the editor on Edit", async () => {
    setup(true);
    renderDetail();
    fireEvent.click(await screen.findByText("detail.edit"));
    expect(await screen.findByTestId("editor")).toBeTruthy();
    expect(screen.getByText("editor.save")).toBeTruthy();
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

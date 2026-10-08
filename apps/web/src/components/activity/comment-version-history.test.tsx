import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommentVersionHistory from "./comment-version-history";

const query = vi.hoisted(() => ({
  current: undefined as
    | {
        data?: {
          pages: {
            data: {
              number: number;
              body: unknown;
              editedBy: string | null;
              createdAt: string;
            }[];
            page: { nextCursor: string | null; hasMore: boolean };
          }[];
        };
        isLoading: boolean;
        isError: boolean;
        hasNextPage: boolean;
        isFetchingNextPage: boolean;
        fetchNextPage: () => void;
        refetch: () => void;
      }
    | undefined,
  options: [] as { key: string; commentId: string; enabled: boolean }[],
}));

vi.mock("@/hooks/queries/work-item/use-get-comment-version-history", () => ({
  default: (options: { key: string; commentId: string; enabled: boolean }) => {
    query.options.push(options);
    return query.current;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  query.current = undefined;
  query.options.length = 0;
});

vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    documentValue,
    value,
  }: {
    documentValue?: unknown;
    value: string;
  }) => <div>{value || JSON.stringify(documentValue)}</div>,
}));

vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));

vi.mock("@taskdesk/ui", async (importOriginal) => {
  const React = await import("react");
  const Context = React.createContext({
    open: false,
    setOpen: (_value: boolean) => {},
  });
  function Popover({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (value: boolean) => void;
  }) {
    return (
      <Context.Provider value={{ open, setOpen: onOpenChange }}>
        {children}
      </Context.Provider>
    );
  }
  function PopoverTrigger({ children }: { children: React.ReactElement }) {
    const state = React.useContext(Context);
    return React.cloneElement(
      children as React.ReactElement<{ onClick?: () => void }>,
      { onClick: () => state.setOpen(!state.open) },
    );
  }
  function PopoverContent({ children }: { children: React.ReactNode }) {
    return React.useContext(Context).open ? (
      <div role="dialog">{children}</div>
    ) : null;
  }
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  return { ...actual, Popover, PopoverTrigger, PopoverContent };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("CommentVersionHistory", () => {
  it("loads pages only after opening and preserves version order and legacy bodies", () => {
    query.current = {
      data: {
        pages: [
          {
            data: [
              {
                number: 1,
                body: "legacy transition",
                editedBy: "person-1",
                createdAt: "2026-10-08T12:00:00.000Z",
              },
            ],
            page: { hasMore: true, nextCursor: "next" },
          },
          {
            data: [
              {
                number: 2,
                body: { type: "doc", content: [] },
                editedBy: "person-2",
                createdAt: "2026-10-08T12:01:00.000Z",
              },
            ],
            page: { hasMore: false, nextCursor: null },
          },
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
    query.options.length = 0;
    render(
      <CommentVersionHistory
        workItemKey="TD-1"
        commentId="comment-1"
        editorName={(id) => (id === "person-1" ? "Alice" : "Unknown")}
        label="Edited"
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(query.options.at(-1)?.enabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edited" }));
    expect(screen.getByText("legacy transition")).toBeInTheDocument();
    expect(screen.getByText('{"type":"doc","content":[]}')).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("2026-10-08T12:00:00.000Z")).toBeInTheDocument();
    expect(query.options.at(-1)).toEqual({
      key: "TD-1",
      commentId: "comment-1",
      enabled: true,
    });
  });

  it("offers retry without discarding the error state", () => {
    const refetch = vi.fn();
    query.current = {
      isLoading: false,
      isError: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch,
    };
    render(
      <CommentVersionHistory
        workItemKey="TD-1"
        commentId="comment-1"
        editorName={() => "Editor"}
        label="Edited"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edited" }));
    fireEvent.click(
      screen.getByRole("button", { name: "activity:timeline.retry" }),
    );
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("requests the next bounded page on demand", () => {
    const fetchNextPage = vi.fn();
    query.current = {
      data: {
        pages: [
          {
            data: [
              {
                number: 1,
                body: "first",
                editedBy: null,
                createdAt: "2026-10-08T12:00:00.000Z",
              },
            ],
            page: { hasMore: true, nextCursor: "opaque" },
          },
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
      refetch: vi.fn(),
    };
    render(
      <CommentVersionHistory
        workItemKey="TD-1"
        commentId="comment-1"
        editorName={() => "Editor"}
        label="Edited"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edited" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "activity:timeline.loadEarlierVersions",
      }),
    );
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });
});

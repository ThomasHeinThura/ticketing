import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CommentVersion } from "@/fetchers/work-item/get-work-item-activity";
import CommentVersionHistory from "./comment-version-history";

vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    documentValue,
    value,
  }: {
    documentValue?: unknown;
    value: string;
  }) => {
    const text = `${value} ${JSON.stringify(documentValue)}`;
    return (
      <div>
        {text.includes("prior version")
          ? "prior version"
          : text.includes("legacy transition")
            ? "legacy transition"
            : text}
      </div>
    );
  },
}));

vi.mock("@/lib/format", () => ({
  formatRelativeTime: (value: string) => value,
  formatDateTime: (value: string) => value,
}));

vi.mock("@taskdesk/ui", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();

  function Tooltip({ children }: { children: ReactNode }) {
    const [open, setOpen] = React.useState(false);
    return React.Children.map(children, (child) =>
      isValidElement(child)
        ? cloneElement(
            child as ReactElement<{
              open?: boolean;
              setOpen?: (open: boolean) => void;
            }>,
            { open, setOpen },
          )
        : child,
    );
  }

  function TooltipTrigger({
    children,
    setOpen,
  }: {
    children: ReactElement;
    setOpen?: (open: boolean) => void;
  }) {
    return cloneElement(children as ReactElement<Record<string, unknown>>, {
      onMouseEnter: () => setOpen?.(true),
      onMouseLeave: () => setOpen?.(false),
      onFocus: () => setOpen?.(true),
      onBlur: () => setOpen?.(false),
    });
  }

  function TooltipContent({
    children,
    open,
  }: {
    children: ReactNode;
    open?: boolean;
  }) {
    return open ? <div role="tooltip">{children}</div> : null;
  }

  return {
    ...actual,
    Tooltip,
    TooltipContent,
    TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger,
  };
});

const versions: CommentVersion[] = [
  {
    number: 1,
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "prior version" }],
        },
      ],
    },
    editedBy: "person-1",
    createdAt: "2026-10-08T12:00:00.000Z",
  },
  {
    number: 2,
    body: "legacy transition note",
    editedBy: "person-1",
    createdAt: "2026-10-08T12:01:00.000Z",
  },
];

describe("CommentVersionHistory", () => {
  it("reveals the stored prior body and timestamp on hover and keyboard focus", async () => {
    render(
      <CommentVersionHistory
        editorName={() => "Editor"}
        label="Edited"
        versions={versions}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Edited" });
    fireEvent.mouseEnter(trigger);
    expect(await screen.findByText("prior version")).toBeInTheDocument();
    expect(screen.getByText("legacy transition")).toBeInTheDocument();
    expect(screen.getAllByText("Editor")).toHaveLength(2);
    expect(screen.getByText("2026-10-08T12:00:00.000Z")).toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText("prior version")).not.toBeInTheDocument();
    fireEvent.focus(trigger);
    expect(await screen.findByText("prior version")).toBeInTheDocument();
  });

  it("renders nothing when the server omits history", () => {
    const { container } = render(
      <CommentVersionHistory
        editorName={() => "Editor"}
        label="Edited"
        versions={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

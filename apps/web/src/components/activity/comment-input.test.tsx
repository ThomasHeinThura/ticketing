import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CommentInput from "./comment-input";

const mocks = vi.hoisted(() => ({ editorRender: vi.fn() }));

vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => {
    mocks.editorRender();
    return (
      <textarea
        aria-label="Comment"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  },
}));

vi.mock("@/hooks/mutations/comment/use-create-comment", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Ctrl",
}));

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@taskdesk/ui", () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Button = ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  );
  return {
    Button,
    KbdSequence: Wrapper,
    Tooltip: Wrapper,
    TooltipContent: Wrapper,
    TooltipProvider: Wrapper,
    TooltipTrigger: Wrapper,
  };
});

describe("CommentInput render boundary", () => {
  it("keeps the editor mounted when task activity changes rerender its parent", () => {
    const { rerender } = render(
      <section data-activity-revision="1">
        <CommentInput taskId="task-1" />
      </section>,
    );
    const editor = screen.getByRole("textbox", { name: "Comment" });

    fireEvent.change(editor, { target: { value: "Draft comment" } });
    const rendersAfterDraft = mocks.editorRender.mock.calls.length;
    rerender(
      <section data-activity-revision="2">
        <CommentInput taskId="task-1" />
      </section>,
    );

    expect(mocks.editorRender).toHaveBeenCalledTimes(rendersAfterDraft);
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue(
      "Draft comment",
    );
  });
});

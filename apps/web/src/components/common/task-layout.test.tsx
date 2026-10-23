import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskPageFrame } from "./task-layout";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("@taskdesk/ui", async (original) => ({
  ...(await original<typeof import("@taskdesk/ui")>()),
  useIsMobile: () => viewport.compact,
}));
vi.mock("./layout", () => {
  const Layout = ({ children }: PropsWithChildren) => <main>{children}</main>;
  Layout.Header = ({ children }: PropsWithChildren) => (
    <header>{children}</header>
  );
  Layout.Content = ({ children }: PropsWithChildren) => (
    <article>{children}</article>
  );
  return { default: Layout };
});
afterEach(() => {
  cleanup();
  viewport.compact = false;
});
describe("original shared task page frame", () => {
  it("keeps Properties beside the header on desktop and mounts its live controller once", () => {
    const { rerender } = render(
      <TaskPageFrame
        header={<h1>Task header</h1>}
        rightSidebar={<div data-testid="properties">Properties</div>}
      >
        <p>Task content</p>
      </TaskPageFrame>,
    );
    const header = screen.getByRole("heading");
    const sidebar = screen.getByTestId("properties");
    expect(header.parentElement).not.toContainElement(sidebar);
    expect(screen.getAllByTestId("properties")).toHaveLength(1);
    expect(sidebar.parentElement).toHaveClass(
      "lg:h-full",
      "lg:overflow-y-auto",
    );
    viewport.compact = true;
    rerender(
      <TaskPageFrame
        header={<h1>Task header</h1>}
        rightSidebar={<div data-testid="properties">Properties</div>}
      >
        <p>Task content</p>
      </TaskPageFrame>,
    );
    expect(screen.getAllByTestId("properties")).toHaveLength(1);
    expect(screen.getByTestId("properties").parentElement).toHaveClass(
      "order-1",
      "lg:hidden",
    );
  });
});

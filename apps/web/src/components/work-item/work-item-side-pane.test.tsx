import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkItemSidePane from "./work-item-side-pane";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  detail: vi.fn(),
  project: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to: _to,
    params,
    children,
    ...props
  }: {
    to: string;
    params: { key: string };
    children?: React.ReactNode;
  }) => (
    <a href={`/agent/work-items/${params.key}`} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item", () => ({
  default: (input: { key: string }) => mocks.read(input),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => mocks.project(),
}));
vi.mock("./work-item-actions", () => ({
  default: ({ variant }: { variant: string }) => (
    <span data-testid="canonical-delete-action">{variant}</span>
  ),
}));
vi.mock("@/components/work-item/load-work-item-detail", () => ({
  default: async () => ({
    default: (props: Record<string, unknown>) => {
      mocks.detail(props);
      return (
        <div data-testid="canonical-detail">{String(props.workItemKey)}</div>
      );
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount() {
  mocks.read.mockImplementation(({ key }: { key: string }) => ({
    data: { key, workspaceId: "workspace", projectId: "project" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }));
  mocks.project.mockReturnValue({
    data: [{ id: "project", name: "Help", slug: "HELP" }],
  });
  function Journey() {
    const [key, setKey] = useState<string>();
    return (
      <>
        <Button type="button" onClick={() => setKey("HELP-1")}>
          Open canonical task
        </Button>
        <Button type="button" onClick={() => setKey("HELP-2")}>
          Next canonical task
        </Button>
        <WorkItemSidePane itemKey={key} onClose={() => setKey(undefined)} />
      </>
    );
  }
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Journey />
    </QueryClientProvider>,
  );
}
describe("canonical Kaneo task sheet", () => {
  it("defers persisted detail until open and uses the original modal geometry/blur", async () => {
    mount();
    expect(mocks.read).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Open canonical task" }),
    );
    expect(await screen.findByTestId("canonical-detail")).toHaveTextContent(
      "HELP-1",
    );
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveClass(
      "w-full",
      "max-w-full",
      "sm:max-w-lg",
      "md:max-w-2xl",
      "lg:max-w-4xl",
      "p-0",
      "gap-0",
    );
    expect(document.querySelector('[data-slot="sheet-backdrop"]')).toHaveClass(
      "backdrop-blur-sm",
      "duration-200",
    );
    expect(screen.getByTestId("canonical-delete-action")).toHaveTextContent(
      "delete",
    );
    expect(
      screen.getByRole("link", { name: "workItems:sidePane.openFullPage" }),
    ).toHaveAttribute("href", "/agent/work-items/HELP-1");
    expect(mocks.detail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        variant: "pane",
        workItemKey: "HELP-1",
        project: { name: "Help", slug: "HELP" },
      }),
    );
  });

  it("closes with Escape and restores focus to the invoking board/list control", async () => {
    mount();
    const opener = screen.getByRole("button", { name: "Open canonical task" });
    opener.focus();
    fireEvent.click(opener);
    const detail = await screen.findByTestId("canonical-detail");
    fireEvent.keyDown(detail, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

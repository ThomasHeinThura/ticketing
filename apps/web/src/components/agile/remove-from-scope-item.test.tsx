import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  removeCycleWorkItem: vi.fn(),
  removeModuleWorkItem: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  removeCycleWorkItem: (...args: unknown[]) =>
    mocks.removeCycleWorkItem(...args),
  removeModuleWorkItem: (...args: unknown[]) =>
    mocks.removeModuleWorkItem(...args),
}));
vi.mock("@taskdesk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  return {
    ...actual,
    // The real item needs an open context menu around it.
    ContextMenuItem: ({
      children,
      onClick,
      disabled,
    }: {
      children: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <actual.Button disabled={disabled} onClick={onClick}>
        {children}
      </actual.Button>
    ),
  };
});

import { RemoveFromScopeItem } from "./remove-from-scope-item";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderItem(kind: "cycle" | "module", onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RemoveFromScopeItem
        membership={{ kind, id: "x1", canEdit: true }}
        itemKey="A-7"
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("RemoveFromScopeItem", () => {
  it("removes the item from its cycle and closes the menu", async () => {
    mocks.removeCycleWorkItem.mockResolvedValue({});
    const onClose = renderItem("cycle");
    fireEvent.click(screen.getByText("remove.action.cycle"));
    await waitFor(() =>
      expect(mocks.removeCycleWorkItem).toHaveBeenCalledWith("x1", "A-7"),
    );
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  });

  it("removes the item from its module", async () => {
    mocks.removeModuleWorkItem.mockResolvedValue({});
    renderItem("module");
    fireEvent.click(screen.getByText("remove.action.module"));
    await waitFor(() =>
      expect(mocks.removeModuleWorkItem).toHaveBeenCalledWith("x1", "A-7"),
    );
  });

  it("reports a failure", async () => {
    mocks.removeCycleWorkItem.mockRejectedValue(new Error("no"));
    renderItem("cycle");
    fireEvent.click(screen.getByText("remove.action.cycle"));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  });
});

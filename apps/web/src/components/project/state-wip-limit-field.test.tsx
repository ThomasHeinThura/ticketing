import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setWipLimit: vi.fn(),
  limits: new Map<string, number>(),
  canManage: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  setWipLimit: (...args: unknown[]) => mocks.setWipLimit(...args),
}));
vi.mock("@/hooks/queries/agile/use-wip-limits", () => ({
  default: () => ({ limits: mocks.limits, canManage: mocks.canManage }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "p1", slug: "PRJ" }] }),
}));

import StateWipLimitField from "./state-wip-limit-field";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.limits = new Map();
  mocks.canManage = true;
});

function renderField() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StateWipLimitField
        projectId="p1"
        workspaceId="w1"
        stateId="s1"
        stateName="Doing"
      />
    </QueryClientProvider>,
  );
}

describe("StateWipLimitField (VW-12)", () => {
  it("renders nothing for someone who cannot manage", () => {
    mocks.canManage = false;
    const { container } = renderField();
    expect(container.firstChild).toBeNull();
  });

  it("saves a typed limit for the state", async () => {
    mocks.setWipLimit.mockResolvedValue({ stateId: "s1", limit: 4 });
    renderField();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    const save = screen.getByRole("button", {
      name: "settings:projectStates.wip.save",
    });
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.setWipLimit).toHaveBeenCalledWith("PRJ", "s1", 4),
    );
  });

  it("starts from the stored limit and keeps Save disabled until it changes", () => {
    mocks.limits = new Map([["s1", 3]]);
    renderField();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("3");
    expect(
      (
        screen.getByRole("button", {
          name: "settings:projectStates.wip.save",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

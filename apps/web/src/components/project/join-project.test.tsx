import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinProject } from "./join-project";

const join = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/project-member/project-members", () => ({
  joinProject: join,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Join project", () => {
  for (const role of [
    "owner",
    "admin",
    "manager",
    "lead",
    "member",
    "viewer",
    "custom",
    "customer",
  ]) {
    it(`${role}: server eligibility controls the button`, () => {
      const eligible = ["owner", "admin", "manager"].includes(role);
      render(
        <QueryClientProvider client={new QueryClient()}>
          <JoinProject projectId="p" canJoin={eligible} />
        </QueryClientProvider>,
      );
      expect(Boolean(screen.queryByRole("button"))).toBe(eligible);
    });
  }
  it("shows pending feedback and removes both hint and button after success", async () => {
    let finish: (() => void) | undefined;
    join.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <JoinProject projectId="p" canJoin />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true),
    );
    expect(screen.getByText("projects.joining")).toBeTruthy();
    finish?.();
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.queryByText("projects.notMember")).toBeNull();
    expect(join).toHaveBeenCalledWith("p");
  });
  it("keeps the join action available after a refusal so it can be retried", async () => {
    join.mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce([]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <JoinProject projectId="p" canJoin />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(join).toHaveBeenCalledTimes(2);
  });
});

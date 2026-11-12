import { act, cleanup, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AuthProvider, { AuthContext } from "./index";

const state = vi.hoisted(() => ({
  pending: true,
  error: null as Error | null,
  user: null as { id: string } | null,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: state.user },
      isPending: state.pending,
      error: state.error,
      refetch: vi.fn(),
    }),
  },
}));
function Content() {
  const { user } = useContext(AuthContext);
  return <div>{user ? "Signed in" : "Signed out"}</div>;
}
beforeEach(() => {
  vi.useFakeTimers();
  state.pending = true;
  state.error = null;
  state.user = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("suppresses a fast session placeholder and preserves the session", () => {
  const view = render(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  expect(
    view.container.querySelector('[data-slot="skeleton"]'),
  ).not.toBeVisible();
  act(() => vi.advanceTimersByTime(40));
  state.pending = false;
  state.user = { id: "u" };
  view.rerender(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  expect(screen.getByText("Signed in")).toBeVisible();
  state.pending = true;
  view.rerender(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  expect(screen.getByText("Signed in")).toBeVisible();
});
it("retains a visible session placeholder after the read completes", () => {
  const view = render(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  act(() => vi.advanceTimersByTime(150));
  state.pending = false;
  state.user = { id: "u" };
  view.rerender(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  expect(view.container.querySelector('[data-slot="skeleton"]')).toBeVisible();
  act(() => vi.advanceTimersByTime(300));
  expect(screen.getByText("Signed in")).toBeVisible();
});
it("retains a slow session placeholder and bypasses it for an error", () => {
  const view = render(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  act(() => vi.advanceTimersByTime(150));
  expect(view.container.querySelector('[data-slot="skeleton"]')).toBeVisible();
  state.pending = false;
  state.error = new Error("failed");
  view.rerender(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  expect(screen.getByText("Signed out")).toBeVisible();
});

import { act, cleanup, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AuthProvider, { AuthContext } from "./index";

const state = vi.hoisted(() => ({
  ready: true,
  sessionStarted: vi.fn(),
  pending: true,
  error: null as Error | null,
  user: null as { id: string } | null,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => {
      state.sessionStarted();
      return {
        data: { user: state.user },
        isPending: state.pending,
        error: state.error,
        refetch: vi.fn(),
      };
    },
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: (
    _namespace: unknown,
    options: { useSuspense?: boolean } = {},
  ) => {
    if (!state.ready && options.useSuspense !== false)
      throw new Promise(() => {});
    return {
      ready: state.ready,
      t: () => (state.ready ? "Loading…" : "common:empty.loading"),
    };
  },
}));
function Content() {
  const { user } = useContext(AuthContext);
  return <div>{user ? "Signed in" : "Signed out"}</div>;
}
beforeEach(() => {
  vi.useFakeTimers();
  state.ready = true;
  state.sessionStarted.mockClear();
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

it("commits the skeleton and starts the session before translations load", () => {
  state.ready = false;
  const view = render(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  expect(state.sessionStarted).toHaveBeenCalled();
  expect(
    view.container.querySelector('[data-slot="skeleton"]'),
  ).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(150));
  expect(view.container.querySelector('[data-slot="skeleton"]')).toBeVisible();
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  state.ready = true;
  view.rerender(
    <AuthProvider>
      <Content />
    </AuthProvider>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading…");
});

it("releases a visible session placeholder immediately on direct work-list visits once resolved", () => {
  const previousPath = window.location.pathname;
  window.history.replaceState({}, "", "/agent/projects/WLP/work");
  try {
    const view = render(
      <AuthProvider>
        <Content />
      </AuthProvider>,
    );
    act(() => vi.advanceTimersByTime(150));
    expect(
      view.container.querySelector('[data-slot="skeleton"]'),
    ).toBeVisible();
    state.pending = false;
    state.user = { id: "u" };
    view.rerender(
      <AuthProvider>
        <Content />
      </AuthProvider>,
    );
    expect(screen.getByText("Signed in")).toBeVisible();
  } finally {
    window.history.replaceState({}, "", previousPath);
  }
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./users";

const mocks = vi.hoisted(() => ({
  search: { user: "user-a" } as Record<string, string | undefined>,
  changed: (() => {}) as () => void,
  grantAdmin: vi.fn(),
  createProof: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    fullPath: "/agent/god-mode/users",
    useSearch: () => mocks.search,
  }),
  useNavigate:
    () =>
    (options: {
      search: (current: typeof mocks.search) => typeof mocks.search;
    }) => {
      mocks.search = options.search(mocks.search);
      mocks.changed();
    },
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { enabled: true, required: true } }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/fetchers/god-mode/instance-users", () => ({
  createUserOperationProof: (...args: unknown[]) => mocks.createProof(...args),
  getCurrentFactorStatus: vi.fn(),
}));

vi.mock("@/hooks/queries/god-mode/use-instance-users", () => ({
  useInstanceUsers: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: { data: [userA, userB], page: { hasMore: false } },
    refetch: vi.fn(),
  }),
  useInstanceUser: (id?: string) => ({
    data: id === userB.id ? userB : userA,
    isPending: false,
    isError: false,
  }),
  useInstanceUserActions: () => ({
    suspend: { isPending: false, mutateAsync: vi.fn() },
    unsuspend: { isPending: false, mutateAsync: vi.fn() },
    signOut: { isPending: false, mutateAsync: vi.fn() },
    deactivate: { isPending: false, mutateAsync: vi.fn() },
    grantAdmin: { isPending: false, mutateAsync: mocks.grantAdmin },
    resetMfa: { isPending: false, mutateAsync: vi.fn() },
  }),
}));

const userA = {
  id: "user-a",
  name: "Account A",
  email: "a@example.test",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  locale: "en",
  isInstanceAdmin: false,
  isSuspended: false,
  suspensionExpiresAt: null,
  twoFactorEnabled: false,
  person: {
    id: "person-a",
    side: "staff",
    organisationId: null,
    organisationName: null,
    active: true,
    isPlaceholder: false,
  },
};
const userB = {
  ...userA,
  id: "user-b",
  name: "Account B",
  email: "b@example.test",
};

function Harness() {
  const [, rerender] = useState(0);
  mocks.changed = () => rerender((value) => value + 1);
  const RouteComponent = Route.options.component;
  if (!RouteComponent) throw new Error("Users route component is missing");
  return <RouteComponent />;
}

async function flushActionContextEffect() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("God Mode Users action context", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    mocks.search = { user: userA.id };
    mocks.grantAdmin.mockReset();
    mocks.createProof.mockReset();
  });

  it("clears action fields and refuses a proof completed after the URL target changes", async () => {
    let finishProof: ((value: string) => void) | undefined;
    mocks.createProof.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishProof = resolve;
        }),
    );
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "instanceUsers:copy.d6ac6adb7aa6" }),
    );
    await waitFor(() => expect(mocks.search.action).toBe("grant-admin"));
    await flushActionContextEffect();
    fireEvent.change(
      screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
      {
        target: { value: "sensitive-password" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "instanceUsers:dynamic.actions.grantAdmin",
      }),
    );
    await waitFor(() => expect(mocks.createProof).toHaveBeenCalledOnce());

    act(() => {
      mocks.search = { user: userB.id };
      mocks.changed();
    });
    await waitFor(() =>
      expect(
        screen.queryByText("instanceUsers:dynamic.actions.grantAdmin"),
      ).toBeNull(),
    );
    expect(mocks.search.action).toBeUndefined();
    expect(screen.queryByDisplayValue("sensitive-password")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "instanceUsers:copy.d6ac6adb7aa6",
      }),
    );
    await waitFor(() => expect(mocks.search.action).toBe("grant-admin"));
    expect(
      screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
    ).toHaveValue("");

    await act(async () => finishProof?.("proof-for-a"));
    expect(mocks.grantAdmin).not.toHaveBeenCalled();
  });

  it("invalidates a pending proof when Back restores the same URL action context", async () => {
    let finishProof: ((value: string) => void) | undefined;
    mocks.createProof.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishProof = resolve;
        }),
    );
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "instanceUsers:copy.d6ac6adb7aa6" }),
    );
    await waitFor(() => expect(mocks.search.action).toBe("grant-admin"));
    await flushActionContextEffect();
    fireEvent.input(
      screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
      { target: { value: "first-secret" } },
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
      ).toHaveValue("first-secret"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "instanceUsers:dynamic.actions.grantAdmin",
      }),
    );
    await waitFor(() => expect(mocks.createProof).toHaveBeenCalledOnce());

    act(() => {
      mocks.search = { user: userB.id };
      mocks.changed();
    });
    await waitFor(() =>
      expect(
        screen.queryByText("instanceUsers:dynamic.actions.grantAdmin"),
      ).toBeNull(),
    );
    act(() => {
      mocks.search = { user: userA.id, action: "grant-admin" };
      mocks.changed();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    await flushActionContextEffect();

    await act(async () => finishProof?.("proof-from-first-context"));
    expect(mocks.grantAdmin).not.toHaveBeenCalled();
  });

  it("ignores a rejected proof after cancel and reopening the same action", async () => {
    let rejectProof: ((error: Error) => void) | undefined;
    mocks.createProof.mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectProof = reject;
        }),
    );
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "instanceUsers:copy.d6ac6adb7aa6" }),
    );
    await waitFor(() => expect(mocks.search.action).toBe("grant-admin"));
    await flushActionContextEffect();
    fireEvent.input(
      screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
      { target: { value: "first-secret" } },
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
      ).toHaveValue("first-secret"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "instanceUsers:dynamic.actions.grantAdmin",
      }),
    );
    await waitFor(() => expect(mocks.createProof).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole("button", { name: "instanceUsers:copy.77dfd2135f4d" }),
    );
    await waitFor(() => expect(mocks.search.action).toBeUndefined());
    fireEvent.click(
      screen.getByRole("button", { name: "instanceUsers:copy.d6ac6adb7aa6" }),
    );
    await waitFor(() => expect(mocks.search.action).toBe("grant-admin"));
    await flushActionContextEffect();
    expect(
      screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
    ).toHaveValue("");

    await act(async () => rejectProof?.(new Error("old proof failed")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.grantAdmin).not.toHaveBeenCalled();
  });

  it("keeps directory row links shrinkable so long emails wrap inside a 375px viewport", () => {
    // jsdom has no layout engine; this pins the class contract the real-browser
    // 375px probe measured (an inline link wrapping unbreakable block text made
    // the first column wider than the viewport).
    render(<Harness />);
    // The mocked Link renders an <a> without href, so query by aria-label.
    const [link] = screen.getAllByLabelText("instanceUsers:selectUser");
    if (!link) throw new Error("directory row link missing");
    expect(link.className).toMatch(/\bblock\b/u);
    expect(link.className).toMatch(/\bmin-w-0\b/u);
    expect(link.className).toMatch(/\bmax-w-full\b/u);
    // The cell must not be whitespace-nowrap (the table default), or break-all is inert.
    expect(link.closest("td")?.className).toMatch(/\bwhitespace-normal\b/u);
    // Type/Organisation columns drop below sm (no horizontal table scroll at
    // 320-375px, docs/02-design/accessibility.md "Zoom and reflow"); their content
    // stays available in the first cell.
    const hiddenCells = Array.from(document.querySelectorAll("td")).filter(
      (td) => td.className.includes("max-sm:hidden"),
    );
    expect(hiddenCells.length).toBe(4); // 2 users x (Type, Organisation)
    const email = screen.getAllByText(userA.email)[0];
    expect(email?.className).toMatch(/\bbreak-all\b/u);
  });

  it("invalidates a pending proof when the Users route unmounts", async () => {
    let finishProof: ((value: string) => void) | undefined;
    mocks.createProof.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishProof = resolve;
        }),
    );
    const { unmount } = render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "instanceUsers:copy.d6ac6adb7aa6" }),
    );
    await waitFor(() => expect(mocks.search.action).toBe("grant-admin"));
    await flushActionContextEffect();
    fireEvent.input(
      screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
      { target: { value: "first-secret" } },
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("instanceUsers:dynamic.authenticatorCode"),
      ).toHaveValue("first-secret"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "instanceUsers:dynamic.actions.grantAdmin",
      }),
    );
    await waitFor(() => expect(mocks.createProof).toHaveBeenCalledOnce());

    unmount();
    await act(async () => finishProof?.("proof-after-unmount"));
    expect(mocks.grantAdmin).not.toHaveBeenCalled();
  });
});

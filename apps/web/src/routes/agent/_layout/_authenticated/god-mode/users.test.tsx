import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceUsersPage } from "./users";

const mocks = vi.hoisted(() => ({
  search: { user: "user-a" } as Record<string, string | undefined>,
  changed: (() => {}) as () => void,
  grantAdmin: vi.fn(),
  createProof: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    fullPath: "/god-mode/users",
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
  return <InstanceUsersPage />;
}

describe("God Mode Users action context", () => {
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
});

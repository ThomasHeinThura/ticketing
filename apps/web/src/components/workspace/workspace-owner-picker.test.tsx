import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { WorkspaceOwnerPicker } from "./workspace-owner-picker";

const mocks = vi.hoisted(() => ({
  useInstanceUsers: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/hooks/queries/god-mode/use-instance-users", () => ({
  useInstanceUsers: mocks.useInstanceUsers,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { id: "u-admin", name: "Ada Admin", email: "ada@example.com" },
      },
    }),
  },
}));

function directory(
  users: Array<{
    id: string;
    name: string;
    email: string;
    isSuspended?: boolean;
  }>,
) {
  return {
    data: {
      data: users.map((user) => ({ isSuspended: false, ...user })),
    },
    isPending: false,
    isError: false,
  };
}

afterEach(() => {
  cleanup();
  mocks.useInstanceUsers.mockReset();
});

describe("WorkspaceOwnerPicker (D-A, 12 Nov 2026)", () => {
  it("defaults the owner to the signed-in administrator and shows who that is", () => {
    mocks.useInstanceUsers.mockReturnValue(directory([]));
    const onChange = vi.fn();

    render(<WorkspaceOwnerPicker value={null} onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith("u-admin");
    expect(
      screen.getByRole("combobox", { name: "Workspace owner" }),
    ).toHaveValue("Ada Admin (ada@example.com)");
  });

  it("does not overwrite a choice that was already made", () => {
    mocks.useInstanceUsers.mockReturnValue(directory([]));
    const onChange = vi.fn();

    render(<WorkspaceOwnerPicker value="u-other" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("only lists active staff users, searched on the server", () => {
    mocks.useInstanceUsers.mockReturnValue(directory([]));

    render(<WorkspaceOwnerPicker value="u-admin" onChange={vi.fn()} />);

    expect(mocks.useInstanceUsers).toHaveBeenCalledWith({
      side: "staff",
      active: "true",
      limit: "20",
    });
  });

  it("offers matching staff and leaves suspended users out", async () => {
    mocks.useInstanceUsers.mockReturnValue(
      directory([
        { id: "u-bo", name: "Bo Builder", email: "bo@example.com" },
        {
          id: "u-sam",
          name: "Sam Suspended",
          email: "sam@example.com",
          isSuspended: true,
        },
      ]),
    );

    render(<WorkspaceOwnerPicker value="u-admin" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle options" }));

    expect(
      await screen.findByRole("option", {
        name: "Bo Builder (bo@example.com)",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Sam Suspended/ })).toBeNull();
  });
});

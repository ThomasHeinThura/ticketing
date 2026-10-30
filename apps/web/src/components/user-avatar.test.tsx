import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/lib/routes";
import { translate } from "@/test/en-translation";
import { UserAvatar } from "./user-avatar";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.test" },
  }),
}));
vi.mock("@/hooks/mutations/use-sign-out", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/store/project", () => ({
  default: () => ({ setProject: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  mocks.navigate.mockReset();
});

describe("UserAvatar account settings entry (L-03)", () => {
  it("opens Account settings at the account information page", async () => {
    render(<UserAvatar />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Account settings" }),
    );

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: routes.accountInformation.path,
    });
    expect(routes.accountInformation.path).toBe(
      "/dashboard/settings/account/information",
    );
  });
});

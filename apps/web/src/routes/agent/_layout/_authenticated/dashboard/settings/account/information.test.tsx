import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { expect, it, vi } from "vitest";
import { Route } from "./information";

const mock = vi.hoisted(() => ({
  id: "u1",
  user: { id: "u1", name: "User", email: "user@example.test" },
  session: "s1",
  history: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({
    user: mock.user,
    refetchUser: vi.fn(),
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: mock.id }, session: { id: mock.session } },
    }),
  },
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: (props: unknown) => {
    mock.history(props);
    return <p>Profile history</p>;
  },
}));
vi.mock("@/hooks/mutations/use-update-user-profile", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/use-update-user-avatar", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/use-remove-user-avatar", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/use-delete-account", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
  SESSION_TOO_OLD: "old",
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

it("mounts profile history by target only", async () => {
  const client = new QueryClient();
  const Component = (Route as unknown as { component: ComponentType })
    .component;
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  await screen.findByText("Profile history");
  expect(mock.history).toHaveBeenCalledWith({
    target: { kind: "self", audience: "staff", section: "profile" },
  });
});

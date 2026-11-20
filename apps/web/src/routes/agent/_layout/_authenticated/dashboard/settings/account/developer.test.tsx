import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "./developer";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  sessionId: "s1" as string | undefined,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/settings/api-key-table", () => ({
  ApiKeyTable: () => <p>Personal key table</p>,
}));
vi.mock("@/components/settings/create-api-key-dialog", () => ({
  CreateApiKeyDialog: () => null,
}));
vi.mock("@/components/settings/api-key-created-modal", () => ({
  ApiKeyCreatedModal: () => null,
}));
vi.mock("@/components/settings/service-keys-card", () => ({
  ServiceKeysCard: () => <p>Service keys</p>,
}));
vi.mock("@/components/settings/personal-self-history", () => ({
  PersonalSelfHistory: (props: unknown) => {
    mocks.history(props);
    return <p>Personal key history</p>;
  },
}));
vi.mock("@/hooks/queries/use-get-api-keys", () => ({
  default: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: mocks.sessionId
        ? {
            user: { id: "u1" },
            session: { id: mocks.sessionId },
          }
        : null,
    }),
  },
}));

const Developer = (Route as unknown as { component: ComponentType }).component;
afterEach(() => {
  cleanup();
  mocks.sessionId = "s1";
  mocks.history.mockReset();
});

it("keeps the personal-key table and service keys while mounting self History", () => {
  render(<Developer />);
  expect(screen.getByText("Personal key table")).toBeInTheDocument();
  expect(screen.getByText("Service keys")).toBeInTheDocument();
  expect(screen.getByText("Personal key history")).toBeInTheDocument();
  expect(mocks.history).toHaveBeenCalledWith({
    section: "apiKeys",
    audience: "staff",
    userId: "u1",
    sessionId: "s1",
  });
});

it("does not mount key History without an authenticated session", () => {
  mocks.sessionId = undefined;
  render(<Developer />);
  expect(screen.getByText("Personal key table")).toBeInTheDocument();
  expect(screen.queryByText("Personal key history")).toBeNull();
});

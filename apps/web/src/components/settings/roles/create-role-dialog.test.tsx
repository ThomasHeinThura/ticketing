import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  prove: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: (...args: unknown[]) => mocks.prove(...args),
}));
vi.mock("@/fetchers/god-mode/instance-users", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/god-mode/instance-users")>();
  return {
    ...actual,
    getCurrentFactorStatus: async () => ({ enabled: false, required: false }),
  };
});
vi.mock("@/fetchers/workspace-roles", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/workspace-roles")>();
  return {
    ...actual,
    createRole: (...args: unknown[]) => mocks.create(...args),
  };
});

import { CreateRoleDialog } from "./create-role-dialog";

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ id: "role-new" });
  mocks.prove.mockReset().mockResolvedValue("step-up-token");
  mocks.navigate.mockReset();
});
afterEach(cleanup);

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateRoleDialog
        workspaceId="ws-1"
        roles={[]}
        callerRank={100}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("CreateRoleDialog", () => {
  it("cannot create until a fresh verification is entered, then spends one bound to the role", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Auditors" },
    });
    const create = screen.getByRole("button", { name: "Create role" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.prove).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "workspace_role_create",
        workspaceId: "ws-1",
        role: "Auditors",
      }),
      { method: "password", secret: "correct horse" },
    );
    expect(mocks.create).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ role: "Auditors" }),
      "step-up-token",
    );
  });

  it("creates nothing when the verification fails", async () => {
    mocks.prove.mockRejectedValue(new Error("refused"));
    renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Auditors" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create role" }));
    expect(
      await screen.findAllByText(
        "Fresh verification failed. Nothing was changed.",
      ),
    ).not.toHaveLength(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

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
vi.mock("@/fetchers/service-keys", () => ({
  createServiceKey: (...args: unknown[]) => mocks.create(...args),
}));

import { CreateServiceKeyDialog } from "./create-service-key-dialog";

beforeEach(() => {
  mocks.create
    .mockReset()
    .mockResolvedValue({ id: "k1", name: "Pipeline", key: "tdk_secret" });
  mocks.prove.mockReset().mockResolvedValue("step-up-token");
});
afterEach(cleanup);

function renderDialog(onCreated = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateServiceKeyDialog
        workspaceId="ws-1"
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return onCreated;
}

describe("CreateServiceKeyDialog", () => {
  it("cannot create until a fresh verification is entered, then spends one bound to the exact key", async () => {
    const onCreated = renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Pipeline" },
    });
    const create = screen.getByRole("button", { name: "Create key" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.prove).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "service_key_create",
        workspaceId: "ws-1",
        name: "Pipeline",
        capabilities: expect.arrayContaining(["workspace:read"]),
      }),
      { method: "password", secret: "correct horse" },
    );
    expect(mocks.create).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ name: "Pipeline" }),
      "step-up-token",
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("creates nothing when the verification fails", async () => {
    mocks.prove.mockRejectedValue(new Error("refused"));
    renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Pipeline" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(
      await screen.findAllByText(
        "Fresh verification failed. Nothing was created.",
      ),
    ).not.toHaveLength(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

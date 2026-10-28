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
import {
  INSTANCE_WRITE_CAPABILITIES,
  READ_CAPABILITIES,
} from "./create-api-key-dialog";
import { describeCapability } from "./roles/capability-model";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  resetCreatedKey: vi.fn(),
  role: "admin" as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      translate(key, options),
  }),
}));

vi.mock("@/hooks/mutations/api-key/use-create-api-key", () => ({
  default: () => ({
    mutateAsync: mocks.createApiKey,
    reset: mocks.resetCreatedKey,
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { role: mocks.role } } }),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { CreateApiKeyDialog } from "./create-api-key-dialog";

function renderDialog(onSuccess = vi.fn(), onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CreateApiKeyDialog open onClose={onClose} onSuccess={onSuccess} />
    </QueryClientProvider>,
  );
  return { onSuccess, onClose };
}

beforeEach(() => {
  mocks.role = "admin";
  mocks.createApiKey.mockReset().mockResolvedValue({ key: "secret" });
  mocks.resetCreatedKey.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("CreateApiKeyDialog write capability labels", () => {
  it("names each capability switch and submits the selected capability unchanged", async () => {
    renderDialog();

    const allowWrites = screen.getByRole("switch", {
      name: translate("settings:apiKey.createDialog.writesLabel"),
    });
    fireEvent.click(allowWrites);
    expect(allowWrites).toHaveAttribute("aria-checked", "true");

    const capability = "work_item:create";
    const capabilitySwitch = screen.getByRole("switch", {
      name: describeCapability(capability),
    });
    expect(capabilitySwitch).toHaveAttribute("id");
    fireEvent.click(capabilitySwitch);
    expect(capabilitySwitch).toHaveAttribute("aria-checked", "true");

    fireEvent.change(
      screen.getByRole("textbox", {
        name: translate("settings:apiKey.createDialog.nameLabel"),
      }),
      { target: { value: "Automation key" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:apiKey.createDialog.create"),
      }),
    );

    await waitFor(() =>
      expect(mocks.createApiKey).toHaveBeenCalledWith({
        name: "Automation key",
        expiresIn: 2592000,
        isMcp: false,
        capabilities: [...READ_CAPABILITIES, capability],
      }),
    );
  });

  it("offers instance writes to administrators only after the explicit write opt-in", async () => {
    expect(INSTANCE_WRITE_CAPABILITIES).toContain("instance:admin");
    expect(INSTANCE_WRITE_CAPABILITIES).not.toContain("instance:read_audit");
    renderDialog();

    expect(
      screen.queryByRole("switch", {
        name: describeCapability("instance:admin"),
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("switch", {
        name: translate("settings:apiKey.createDialog.writesLabel"),
      }),
    );
    const adminCapability = screen.getByRole("switch", {
      name: describeCapability("instance:admin"),
    });
    fireEvent.click(adminCapability);
    expect(adminCapability).toHaveAttribute("aria-checked", "true");

    fireEvent.change(
      screen.getByRole("textbox", {
        name: translate("settings:apiKey.createDialog.nameLabel"),
      }),
      { target: { value: "Admin automation key" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:apiKey.createDialog.create"),
      }),
    );

    await waitFor(() =>
      expect(mocks.createApiKey).toHaveBeenCalledWith({
        name: "Admin automation key",
        expiresIn: 2592000,
        isMcp: false,
        capabilities: [...READ_CAPABILITIES, "instance:admin"],
      }),
    );
  });

  it("keeps instance capabilities unavailable to non-admins and defaults to read-only", async () => {
    mocks.role = "member";
    renderDialog();

    const writesOptIn = screen.getByRole("switch", {
      name: translate("settings:apiKey.createDialog.writesLabel"),
    });
    fireEvent.click(writesOptIn);
    expect(
      screen.queryByRole("switch", {
        name: describeCapability("instance:admin"),
      }),
    ).toBeNull();

    fireEvent.change(
      screen.getByRole("textbox", {
        name: translate("settings:apiKey.createDialog.nameLabel"),
      }),
      { target: { value: "Read only key" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("settings:apiKey.createDialog.create"),
      }),
    );

    await waitFor(() =>
      expect(mocks.createApiKey).toHaveBeenCalledWith({
        name: "Read only key",
        expiresIn: 2592000,
        isMcp: false,
      }),
    );
    expect(mocks.createApiKey.mock.calls[0]?.[0].capabilities).toBeUndefined();
  });
});

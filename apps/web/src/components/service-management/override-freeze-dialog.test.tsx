import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeView } from "@/fetchers/service-management";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  overrideFreeze: vi.fn(),
  secret: "",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/components/god-mode/step-up-fields", () => ({
  StepUpFields: () => <div data-testid="step-up-fields" />,
  FailureAlert: () => null,
}));
vi.mock("@/hooks/use-step-up-action", () => ({
  useStepUpAction: () => ({
    method: "password",
    availableMethods: ["password"],
    secret: mocks.secret,
    setMethod: vi.fn(),
    setSecret: vi.fn(),
    busy: false,
    failure: null,
    canRun: Boolean(mocks.secret),
    run: (...args: unknown[]) => mocks.run(...args),
  }),
}));
vi.mock("@/hooks/queries/service-management", () => ({
  useInvalidateServiceManagement: () => vi.fn(),
}));
vi.mock("@/fetchers/service-management", () => ({
  overrideFreeze: (...args: unknown[]) => mocks.overrideFreeze(...args),
}));

import { OverrideFreezeDialog } from "./override-freeze-dialog";

const change = {
  workItemKey: "OPS-1",
  freeze: {
    blocked: true,
    overridden: false,
    freezes: [
      {
        id: "f1",
        name: "Year end",
        startsAt: "2031-01-01T00:00:00Z",
        endsAt: "2031-01-05T00:00:00Z",
      },
    ],
    override: null,
  },
} as unknown as ChangeView;

function setup(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OverrideFreezeDialog
        workspaceId="w1"
        change={change}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  mocks.secret = "correct horse";
  mocks.run.mockImplementation(
    async (
      _binding: unknown,
      execute: (token: string) => Promise<unknown>,
    ) => ({
      ok: true,
      value: await execute("token-1"),
    }),
  );
  mocks.overrideFreeze.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OverrideFreezeDialog", () => {
  it("needs a reason of at least twelve characters and a verification secret", () => {
    mocks.secret = "";
    setup();
    const submit = screen.getByRole("button", {
      name: "override.submit",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("override.reason"), {
      target: { value: "Too short" },
    });
    expect(submit.disabled).toBe(true);
  });

  it("proves the operation bound to the change and reason, then sends the one-use proof", async () => {
    const onClose = setup();
    const reason = "Customer outage fix, approved by the CTO";
    fireEvent.change(screen.getByLabelText("override.reason"), {
      target: { value: `  ${reason}  ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "override.submit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.run).toHaveBeenCalledWith(
      {
        operation: "change_freeze_override",
        workspaceId: "w1",
        workItemKey: "OPS-1",
        reason,
      },
      expect.any(Function),
    );
    expect(mocks.overrideFreeze).toHaveBeenCalledWith(
      "OPS-1",
      reason,
      "token-1",
    );
  });

  it("stays open and shows nothing sent when the verification fails", async () => {
    mocks.run.mockResolvedValue({ ok: false });
    const onClose = setup();
    fireEvent.change(screen.getByLabelText("override.reason"), {
      target: { value: "Customer outage fix, approved by the CTO" },
    });
    fireEvent.click(screen.getByRole("button", { name: "override.submit" }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(mocks.overrideFreeze).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const fake = vi.hoisted(() => ({
  userId: "customer-a",
  get: vi.fn(),
  decide: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: ComponentType }) =>
    Object.assign(config.component, {
      useRouteContext: () => ({ portalUserId: fake.userId }),
      useSearch: () => ({ approval: "approval-1" }),
      fullPath: "/approvals",
    }),
  useNavigate: () => fake.navigate,
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/approval/portal-approvals", () => ({
  getPortalApprovals: fake.get,
  decidePortalApproval: fake.decide,
}));

import { Route } from "./approvals";

const pending = {
  id: "approval-1",
  workItemKey: "HELP-1",
  workItemTitle: "Customer approval",
  state: "pending",
  expiresAt: "2026-10-24T12:00:00Z",
  approverReachLost: false,
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Component = Route as unknown as ComponentType;
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  fake.userId = "customer-a";
  vi.clearAllMocks();
  fake.get.mockReset().mockResolvedValue({ approvals: [pending] });
  fake.decide.mockReset().mockResolvedValue({});
});
afterEach(cleanup);
it("requires a rejection note and sends the selected customer approval decision", async () => {
  setup();
  await screen.findByRole("button", { name: "approvals.reject" });
  const reject = screen.getByRole("button", { name: "approvals.reject" });
  expect(reject).toBeDisabled();
  fireEvent.change(screen.getByLabelText("approvals.note"), {
    target: { value: "Please update the requested scope." },
  });
  fireEvent.click(reject);
  await waitFor(() =>
    expect(fake.decide).toHaveBeenCalledWith(
      {
        id: "approval-1",
        action: "reject",
        note: "Please update the requested scope.",
      },
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(fake.navigate).toHaveBeenCalledWith({ search: {} }),
  );
});
it("refreshes a concurrent decision instead of allowing another stale approval", async () => {
  fake.get
    .mockReset()
    .mockResolvedValueOnce({ approvals: [pending] })
    .mockResolvedValue({ approvals: [{ ...pending, state: "approved" }] });
  fake.decide.mockRejectedValue(new HttpError(409, "Already decided"));
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "approvals.approve" }),
  );
  await screen.findByText("approvals.conflict");
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "approvals.approve" }),
    ).toBeNull(),
  );
  expect(fake.decide).toHaveBeenCalledTimes(1);
});
it("does not offer decisions when the selected approval is no longer addressed to the customer", async () => {
  fake.get.mockResolvedValue({ approvals: [] });
  setup();
  await screen.findByText("approvals.empty");
  expect(
    screen.queryByRole("button", { name: "approvals.approve" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "approvals.reject" })).toBeNull();
  expect(fake.decide).not.toHaveBeenCalled();
});

it("never renders customer A's cached approval when the retained client switches to B", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["portal", "customer-a", "approvals"], {
    approvals: [{ ...pending, workItemTitle: "A confidential approval" }],
  });
  let release: (value: { approvals: (typeof pending)[] }) => void = () => {};
  fake.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const Component = Route as unknown as ComponentType;
  const view = render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  expect(screen.getAllByText(/A confidential approval/).length).toBeGreaterThan(
    0,
  );
  fake.userId = "customer-b";
  view.rerender(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  expect(screen.queryByText(/A confidential approval/)).toBeNull();
  release({ approvals: [{ ...pending, workItemTitle: "B approval" }] });
  await screen.findAllByText(/B approval/);
  expect(screen.queryByText(/A confidential approval/)).toBeNull();
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";
import WorkItemApprovalRequest from "./work-item-approval-request";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  candidates: vi.fn(),
  request: vi.fn(),
  navigate: vi.fn(),
  location: {
    pathname: "/agent/projects/help/work",
    search: {} as Record<string, unknown>,
    searchStr: "?layout=board&item=HELP-4&filter=priority%3Ahigh",
    hash: "",
  },
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useLocation: () => mocks.location,
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/fetchers/approval/request-approval", () => ({
  getApprovalRequestContext: mocks.context,
  getApprovalCandidates: mocks.candidates,
  requestApproval: mocks.request,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
const ready = {
  enabled: true,
  canRequestCustomer: true,
  canRequestCab: true,
  defaultExpiryDays: 7,
  maxExpiryDays: 90,
  transitions: [
    {
      id: "gate-cab",
      fromStateName: "Backlog",
      toStateName: "Review",
      requiresApproval: false,
      requiresCab: true,
    },
  ],
};
function mount(open = true, key = "HELP-4") {
  const state = {
    itemKey: key,
    open: true,
    kind: "cab",
    transitionId: "gate-cab",
  };
  mocks.location.search = open ? { approvalRequest: state } : {};
  mocks.location.searchStr = `?layout=board&item=${key}&filter=priority%3Ahigh${open ? `&approvalRequest=${encodeURIComponent(JSON.stringify(state))}` : ""}`;
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const body = (itemKey = key) => (
    <QueryClientProvider client={cache}>
      <WorkItemApprovalRequest workItemKey={itemKey} />
    </QueryClientProvider>
  );
  const view = render(body());
  mocks.navigate.mockImplementation(({ href }: { href: string }) => {
    const url = new URL(href, "https://test.invalid");
    mocks.location = {
      pathname: url.pathname,
      searchStr: url.search,
      hash: "",
      search: Object.fromEntries(
        [...url.searchParams].map(([name, value]) => [
          name,
          name === "approvalRequest" ? JSON.parse(value) : value,
        ]),
      ),
    };
    view.rerender(body());
    return Promise.resolve();
  });
  return {
    ...view,
    cache,
    changeItem: (key: string) => view.rerender(body(key)),
  };
}
beforeEach(() => {
  mocks.context.mockReset().mockResolvedValue(ready);
  mocks.candidates.mockReset().mockResolvedValue({
    data: [{ id: "person-1", displayName: "Jane Reviewer" }],
    page: { hasMore: false, nextCursor: null },
  });
  mocks.request
    .mockReset()
    .mockResolvedValue({ id: "approval-1", state: "pending" });
  mocks.navigate.mockReset();
});
afterEach(cleanup);
describe("persisted approval request form", () => {
  it("uses real context/candidate fetchers and POST shape, invalidates reads and preserves other URL state", async () => {
    const { cache } = mount();
    const invalidate = vi.spyOn(cache, "invalidateQueries");
    fireEvent.click(
      await screen.findByRole("option", { name: "Jane Reviewer" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Request approval" }),
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(mocks.context).toHaveBeenCalledWith("HELP-4");
    expect(mocks.candidates).toHaveBeenCalledWith("HELP-4", {
      kind: "cab",
      q: "",
    });
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      key: "HELP-4",
      body: { kind: "cab", transitionId: "gate-cab", approverId: "person-1" },
    });
    expect(
      Date.parse(mocks.request.mock.calls[0][0].body.expiresAt) - Date.now(),
    ).toBeGreaterThan(6.9 * 86400000);
    await waitFor(() =>
      expect(mocks.location.searchStr).not.toContain("approvalRequest"),
    );
    expect(mocks.location.searchStr).toContain("filter=priority%3Ahigh");
    expect(mocks.location.searchStr).toContain("item=HELP-4");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["approvals"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "transitions"],
    });
  });
  it("keeps request actions hidden when the server denies authority or disables the feature", async () => {
    mocks.context.mockResolvedValue({
      ...ready,
      enabled: false,
      canRequestCab: false,
      canRequestCustomer: false,
    });
    const { cache } = mount(false);
    await waitFor(() =>
      expect(
        cache.getQueryState(["approvals", "request-context", "HELP-4"])?.status,
      ).toBe("success"),
    );
    expect(
      screen.queryByRole("button", { name: "Request approval" }),
    ).toBeNull();
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("opens and cancels through registered item-scoped URL state", async () => {
    mount(false);
    fireEvent.click(
      await screen.findByRole("button", { name: "Request approval" }),
    );
    expect(mocks.location.searchStr).toContain("approvalRequest");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getAllByRole("button", {
        name: "Cancel",
      })[0] as HTMLElement,
    );
    expect(mocks.location.searchStr).not.toContain("approvalRequest");
    expect(mocks.location.searchStr).toContain("layout=board");
  });
  it("rejects invalid expiry before POST and renders recoverable server failure", async () => {
    mocks.request.mockRejectedValue(new HttpError(422, "private server text"));
    mount();
    fireEvent.click(
      await screen.findByRole("option", { name: "Jane Reviewer" }),
    );
    const expiry = screen.getByRole("spinbutton");
    fireEvent.change(expiry, { target: { value: "91" } });
    const submit = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Request approval",
    });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.change(expiry, { target: { value: "2" } });
    fireEvent.click(submit);
    expect(
      await screen.findByText(
        "The approval could not be requested. Refresh the options and try again.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("private server text");
  });
  it("does not carry an open dialog or selected person to another item", async () => {
    const view = mount();
    fireEvent.click(
      await screen.findByRole("option", { name: "Jane Reviewer" }),
    );
    view.changeItem("HELP-6");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("keeps stale candidate data unselectable after permission loss", async () => {
    mocks.candidates.mockRejectedValue(new HttpError(403, "Forbidden"));
    mount();
    expect(
      await screen.findByText("Eligible approvers could not be loaded."),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Jane Reviewer" })).toBeNull();
    expect(
      within(screen.getByRole("dialog"))
        .getByRole("button", { name: "Request approval" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
  it("shows and retries a transient metadata failure rather than silently hiding the feature", async () => {
    mocks.context
      .mockRejectedValueOnce(new HttpError(503, "private server message"))
      .mockResolvedValue(ready);
    mount(false);
    expect(
      await screen.findByText("Approval request options could not be loaded."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Request approval" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: "Request approval" }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("private server message");
  });
});

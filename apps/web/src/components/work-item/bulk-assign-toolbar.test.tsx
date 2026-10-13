import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";
import BulkAssignToolbar from "./bulk-assign-toolbar";

const bulkAssign = vi.hoisted(() => vi.fn());
const getAssignablePeople = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/work-item/bulk-assign-work-items", () => ({
  default: (...args: unknown[]) => bulkAssign(...args),
}));
vi.mock("@/fetchers/work-item/get-assignable-people", () => ({
  default: (...args: unknown[]) => getAssignablePeople(...args),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(
        typeof options?.count === "number"
          ? `${key}_${options.count === 1 ? "one" : "other"}`
          : key,
        options,
      ),
  }),
}));

/** Base UI selects an option on the real pointer sequence, not on a bare click. */
function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

function mount(
  overrides: Partial<Parameters<typeof BulkAssignToolbar>[0]> = {},
) {
  const onAssigned = vi.fn();
  const onClear = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BulkAssignToolbar
        projectId="proj_1"
        workspaceId="ws_1"
        selectedKeys={["WLP-1", "WLP-2", "WLP-3"]}
        onAssigned={onAssigned}
        onClear={onClear}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onAssigned, onClear, client };
}

async function chooseAssignee() {
  fireEvent.click(
    await screen.findByRole("combobox", {
      name: "Assign selected work items to",
    }),
  );
  pickOption(await screen.findByRole("option", { name: /Riley/ }));
}

const apply = () =>
  fireEvent.click(screen.getByRole("button", { name: "Assign selected" }));

beforeEach(() => {
  bulkAssign.mockReset();
  getAssignablePeople.mockReset();
  getAssignablePeople.mockResolvedValue([
    { personId: "p1", name: "Riley", roleName: "Agent", openWorkCount: 2 },
  ]);
});
afterEach(cleanup);

describe("BulkAssignToolbar", () => {
  it("names the region and counts the selection with the right plural", () => {
    mount();
    expect(
      screen.getByRole("region", { name: "Bulk actions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 work items selected")).toBeInTheDocument();
    cleanup();
    mount({ selectedKeys: ["WLP-1"] });
    expect(screen.getByText("1 work item selected")).toBeInTheDocument();
  });

  it("cannot apply until an assignee is chosen", () => {
    mount();
    expect(
      screen.getByRole("button", { name: "Assign selected" }),
    ).toBeDisabled();
  });

  it("assigns the selected keys in the item workspace and reports them all done", async () => {
    bulkAssign.mockResolvedValue({
      succeeded: ["WLP-1", "WLP-2", "WLP-3"],
      failed: [],
    });
    const { onAssigned, client } = mount();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await chooseAssignee();
    apply();
    await waitFor(() =>
      expect(bulkAssign).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        workItemKeys: ["WLP-1", "WLP-2", "WLP-3"],
        assigneeId: "p1",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "3 assigned, 0 failed.",
    );
    expect(onAssigned).toHaveBeenCalledWith(["WLP-1", "WLP-2", "WLP-3"]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "proj_1"],
    });
  });

  it("on a partial result lists each failure and releases only the succeeded keys", async () => {
    bulkAssign.mockResolvedValue({
      succeeded: ["WLP-1"],
      failed: [
        { id: "WLP-2", reason: "Work item not found" },
        { id: "WLP-3", reason: "Assignee is not a project member" },
      ],
    });
    const { onAssigned } = mount();
    await chooseAssignee();
    apply();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("1 assigned, 2 failed.");
    expect(status).toHaveTextContent("WLP-2: no longer available to you");
    expect(status).toHaveTextContent("WLP-3: Assignee is not a project member");
    expect(onAssigned).toHaveBeenCalledWith(["WLP-1"]);
  });

  it.each([
    [403, "You don't have permission to assign work items."],
    [404, "The selected work items are no longer available to you."],
    [
      409,
      "The selected work items changed in the meantime. Nothing was assigned.",
    ],
    [
      422,
      "These work items can't be assigned to that person. Nothing was assigned.",
    ],
    [400, "The request was not valid, so nothing was assigned."],
    [500, "Couldn't assign the selected work items. Try again."],
  ])(
    "a whole-request HTTP %i shows its message and keeps the selection",
    async (status, text) => {
      bulkAssign.mockRejectedValue(new HttpError(status, "x"));
      const { onAssigned } = mount();
      await chooseAssignee();
      apply();
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(onAssigned).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Assign selected" }),
      ).toBeEnabled();
    },
  );

  it("blocks applying when the assignable people cannot be loaded", async () => {
    getAssignablePeople.mockRejectedValue(new HttpError(500, "x"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the people you can assign to.",
    );
    expect(
      screen.getByRole("button", { name: "Assign selected" }),
    ).toBeDisabled();
  });

  it("clears the selection on request", () => {
    const { onClear } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

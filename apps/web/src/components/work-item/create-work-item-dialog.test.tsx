import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import CreateWorkItemDialog from "./create-work-item-dialog";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  refetchTypes: vi.fn(),
  lastCreateInput: undefined as unknown,
  isPending: false,
  typesState: {
    data: undefined as Array<Record<string, unknown>> | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => mocks.typesState,
}));

vi.mock("@/hooks/mutations/work-item/use-create-work-item", () => ({
  default: (input: unknown) => {
    mocks.lastCreateInput = input;
    return {
      // Capture the input as it was on the render this call came from -- the component
      // resets its state on success, so reading `lastCreateInput` after the flow
      // finishes would see the reset values, not the submitted ones.
      mutateAsync: (...args: unknown[]) =>
        mocks.mutateAsync(mocks.lastCreateInput, ...args),
      isPending: mocks.isPending,
    };
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const TYPES = [
  { id: "type-1", key: "task", name: "Task" },
  { id: "type-2", key: "bug", name: "Bug" },
];

/**
 * Base UI's `Select.Item` selects on the pointer sequence, not on a bare
 * `click` -- a lone `fireEvent.click` opens and highlights but never commits
 * (verified in this file's environment: the popup stays open and
 * `onValueChange` never fires). Dispatch the same sequence a real pointer
 * produces.
 */
function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

function renderDialog(onClose = vi.fn()) {
  render(
    <CreateWorkItemDialog
      open={true}
      onClose={onClose}
      projectId="proj-1"
      workspaceId="ws-1"
    />,
  );
  return onClose;
}

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  mocks.invalidateQueries.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.refetchTypes.mockReset();
  mocks.isPending = false;
  mocks.typesState = {
    data: TYPES,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchTypes,
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("CreateWorkItemDialog", () => {
  it("keeps submit disabled until both a title and a type are chosen", async () => {
    renderDialog();
    const submit = screen.getByRole("button", {
      name: "workItems:create.submit",
    });
    expect(submit).toBeDisabled();
    // The trigger shows the option's LABEL, never the raw value -- a browser run caught the
    // raw `type id` / `high` rendering before `items` was supplied to the Selects.
    expect(
      screen.getByTestId("create-work-item-priority-trigger"),
    ).toHaveTextContent("workItems:create.priorityNone");

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Fix the login bug" },
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("option", { name: "Task" }));
    expect(
      screen.getByTestId("create-work-item-type-trigger"),
    ).toHaveTextContent("Task");
    expect(submit).toBeEnabled();
  });

  it("creates with the chosen type, title, priority and description, then invalidates the list and closes", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "wi-1" });
    const onClose = renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Fix the login bug" },
    });
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("option", { name: "Task" }));

    fireEvent.click(screen.getByTestId("create-work-item-priority-trigger"));
    pickOption(
      await screen.findByRole("option", {
        name: "workItems:list.priority.high",
      }),
    );
    expect(
      screen.getByTestId("create-work-item-priority-trigger"),
    ).toHaveTextContent("workItems:list.priority.high");

    fireEvent.change(screen.getByTestId("create-work-item-description"), {
      target: { value: "First line\nSecond line" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    );

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mocks.mutateAsync.mock.calls[0]?.[0]).toEqual({
      projectId: "proj-1",
      typeId: "type-1",
      title: "Fix the login bug",
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "First line" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Second line" }],
          },
        ],
      },
      priority: "high",
    });
    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["work-items", "proj-1"],
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("workItems:create.success");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the description entirely when left empty", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "wi-1" });
    renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "No description here" },
    });
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("option", { name: "Task" }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    );

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    const submitted = mocks.mutateAsync.mock.calls[0]?.[0] as
      | { description?: unknown; priority?: unknown }
      | undefined;
    expect(submitted?.description).toBeUndefined();
    expect(submitted?.priority).toBeUndefined();
  });

  it("keeps the dialog open and explains a 403 instead of closing", async () => {
    mocks.mutateAsync.mockRejectedValue(new HttpError(403, "Insufficient"));
    const onClose = renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Forbidden attempt" },
    });
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("option", { name: "Task" }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    );

    expect(
      await screen.findByTestId("create-work-item-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:create.errorForbidden"),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the retry affordance and keeps submit disabled when the types request fails", async () => {
    mocks.typesState = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Cannot pick a type" },
    });
    expect(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.typesRetry" }),
    );
    expect(mocks.refetchTypes).toHaveBeenCalledTimes(1);
  });

  it("disables the type select and shows the loading placeholder while types load", () => {
    mocks.typesState = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    const typeTrigger = screen.getByTestId("create-work-item-type-trigger");
    expect(typeTrigger).toHaveAttribute("data-disabled");
    expect(typeTrigger).toHaveTextContent("workItems:create.typesLoading");
    expect(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("workItems:create.noTypes"),
    ).not.toBeInTheDocument();
  });

  it("says so when the workspace has no types at all", () => {
    mocks.typesState = {
      data: [],
      isLoading: false,
      isError: false,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    expect(screen.getByText("workItems:create.noTypes")).toBeInTheDocument();
  });

  it("does not claim the workspace has no types when the query never produced a list", () => {
    mocks.typesState = {
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    expect(
      screen.queryByText("workItems:create.noTypes"),
    ).not.toBeInTheDocument();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateProjectModal from "./create-project-modal";

const mocks = vi.hoisted(() => ({
  organisations: vi.fn(),
  refetch: vi.fn(),
  createProject: vi.fn(),
  createProjectArgs: vi.fn(),
  navigate: vi.fn(),
  canBind: true,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined) }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1", name: "Ops" } }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canBindProjectOrganisation: () => mocks.canBind,
  }),
}));

vi.mock("@/hooks/queries/project/use-customer-organisations", () => ({
  default: (...args: unknown[]) => mocks.organisations(...args),
}));

vi.mock("@/hooks/mutations/project/use-create-project", () => ({
  default: (args: unknown) => {
    mocks.createProjectArgs(args);
    return { mutateAsync: mocks.createProject };
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const loaded = (data: { id: string; name: string }[]) => ({
  data,
  isPending: false,
  isError: false,
  refetch: mocks.refetch,
});

function lastCreateArgs() {
  return mocks.createProjectArgs.mock.calls.at(-1)?.[0] as {
    organisationId: string | null;
    workspaceId: string;
  };
}

function fillAndSubmit() {
  fireEvent.change(
    screen.getByPlaceholderText("common:modals.createProject.projectName"),
    { target: { value: "Acme support" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "common:modals.createProject.createButton",
    }),
  );
}

beforeEach(() => {
  mocks.canBind = true;
  mocks.createProject.mockResolvedValue({ id: "project-1" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("CreateProjectModal customer organisation selector", () => {
  it("hides the selector and never fetches without the strict project:create capability", async () => {
    mocks.canBind = false;
    mocks.organisations.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: mocks.refetch,
    });
    render(<CreateProjectModal open onClose={vi.fn()} />);
    expect(mocks.organisations).toHaveBeenCalledWith(
      { workspaceId: "workspace-1" },
      false,
    );
    expect(screen.queryByTestId("project-organisation")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    fillAndSubmit();
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledTimes(1));
    expect(lastCreateArgs().organisationId).toBeNull();
  });

  it("shows the selector and fetches with the capability", () => {
    mocks.organisations.mockReturnValue(
      loaded([{ id: "org-1", name: "Acme Ltd" }]),
    );
    render(<CreateProjectModal open onClose={vi.fn()} />);
    expect(mocks.organisations).toHaveBeenCalledWith(
      { workspaceId: "workspace-1" },
      true,
    );
    expect(screen.getByTestId("project-organisation")).toBeTruthy();
  });

  it("only loads organisations while the modal is open, for the active workspace", () => {
    mocks.organisations.mockReturnValue(loaded([]));
    render(<CreateProjectModal open={false} onClose={vi.fn()} />);
    expect(mocks.organisations).toHaveBeenCalledWith(
      { workspaceId: "workspace-1" },
      false,
    );
  });

  it("shows a loading state and no selector while organisations load", () => {
    mocks.organisations.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: mocks.refetch,
    });
    render(<CreateProjectModal open onClose={vi.fn()} />);
    expect(screen.getByTestId("project-organisation-loading")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows an error with retry, and still lets an internal project be created", async () => {
    mocks.organisations.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mocks.refetch,
    });
    render(<CreateProjectModal open onClose={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "common:modals.createProject.organisationError",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createProject.organisationRetry",
      }),
    );
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    fillAndSubmit();
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledTimes(1));
    expect(lastCreateArgs().organisationId).toBeNull();
  });

  it("shows an empty state when no customer organisation is active", () => {
    mocks.organisations.mockReturnValue(loaded([]));
    render(<CreateProjectModal open onClose={vi.fn()} />);
    expect(screen.getByTestId("project-organisation-empty")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("defaults to an internal project (null organisation)", async () => {
    mocks.organisations.mockReturnValue(
      loaded([{ id: "org-1", name: "Acme Ltd" }]),
    );
    render(<CreateProjectModal open onClose={vi.fn()} />);
    expect(screen.getByRole("combobox").textContent).toContain(
      "common:modals.createProject.organisationNone",
    );
    expect(lastCreateArgs().organisationId).toBeNull();
    fillAndSubmit();
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledTimes(1));
  });

  it("passes the chosen customer organisation to the create call", async () => {
    mocks.organisations.mockReturnValue(
      loaded([
        { id: "org-1", name: "Acme Ltd" },
        { id: "org-2", name: "Globex" },
      ]),
    );
    render(<CreateProjectModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: "Globex" });
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);

    await waitFor(() => expect(lastCreateArgs().organisationId).toBe("org-2"));
    expect(screen.getByRole("combobox").textContent).toContain("Globex");
    fillAndSubmit();
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledTimes(1));
  });

  async function chooseGlobex() {
    fireEvent.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: "Globex" });
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() => expect(lastCreateArgs().organisationId).toBe("org-2"));
  }

  it("resets the selection to internal when the modal is closed", async () => {
    const organisations = [
      { id: "org-1", name: "Acme Ltd" },
      { id: "org-2", name: "Globex" },
    ];
    mocks.organisations.mockReturnValue(loaded(organisations));
    const onClose = vi.fn();
    render(<CreateProjectModal open onClose={onClose} />);
    await chooseGlobex();

    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(lastCreateArgs().organisationId).toBeNull());
    expect(screen.getByRole("combobox").textContent).toContain(
      "common:modals.createProject.organisationNone",
    );
  });

  it("falls back to internal when the chosen organisation disappears", async () => {
    const organisations = [
      { id: "org-1", name: "Acme Ltd" },
      { id: "org-2", name: "Globex" },
    ];
    mocks.organisations.mockReturnValue(loaded(organisations));
    const view = render(<CreateProjectModal open onClose={vi.fn()} />);
    await chooseGlobex();

    // A refetch no longer lists Globex (deactivated meanwhile).
    mocks.organisations.mockReturnValue(loaded([organisations[0]]));
    view.rerender(<CreateProjectModal open onClose={vi.fn()} />);

    await waitFor(() => expect(lastCreateArgs().organisationId).toBeNull());
    expect(screen.getByRole("combobox").textContent).toContain(
      "common:modals.createProject.organisationNone",
    );
  });
});

describe("CreateProjectModal project key validation (PR-13)", () => {
  function typeName(value: string) {
    fireEvent.change(
      screen.getByPlaceholderText("common:modals.createProject.projectName"),
      { target: { value } },
    );
  }

  it("explains an invalid key and blocks creation until it is 2-8 uppercase letters", async () => {
    render(<CreateProjectModal open onClose={vi.fn()} />);
    // "2024" derives the key "2024", which the API would refuse.
    typeName("2024");
    expect(screen.getByTestId("project-key-error").textContent).toBe(
      "common:modals.createProject.keyInvalid",
    );
    const create = screen.getByRole("button", {
      name: "common:modals.createProject.createButton",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(mocks.createProject).not.toHaveBeenCalled();

    // Typing a key folds to uppercase and clears the message.
    fireEvent.change(screen.getByPlaceholderText("PRO"), {
      target: { value: "web" },
    });
    expect(screen.queryByTestId("project-key-error")).toBeNull();
    expect(create.disabled).toBe(false);
  });

  it("flags a single-letter key as too short", () => {
    render(<CreateProjectModal open onClose={vi.fn()} />);
    typeName("Zed");
    fireEvent.change(screen.getByPlaceholderText("PRO"), {
      target: { value: "Z" },
    });
    expect(screen.getByTestId("project-key-error")).toBeTruthy();
  });
});

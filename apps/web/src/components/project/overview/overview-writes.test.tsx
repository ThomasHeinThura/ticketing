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

// S3 write paths on the Overview milestones panel and the Prerequisites, Team and Documents
// tabs: the right fetcher body on success, the refusal shown on failure, no write controls
// without `project:update`, and the confirmed (never one-click) stakeholder stand-down.

const mocks = vi.hoisted(() => ({
  canUpdate: true,
  listMilestones: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  listPrerequisites: vi.fn(),
  createPrerequisite: vi.fn(),
  updatePrerequisite: vi.fn(),
  deletePrerequisite: vi.fn(),
  listStakeholders: vi.fn(),
  addStakeholder: vi.fn(),
  standDownStakeholder: vi.fn(),
  getProjectRoster: vi.fn(),
  listDocumentLinks: vi.fn(),
  addDocumentLink: vi.fn(),
  deleteDocumentLink: vi.fn(),
  openPendingAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => mocks.canUpdate,
  }),
}));
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: () => ({
    project: { id: "p1", name: "Help desk", slug: "HELP" },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/feature-flag/use-project-pages-feature", () => ({
  default: () => false,
}));
// The library date field opens a calendar popover; a plain library Input stands in for it.
vi.mock("@/components/common/date-field", async () => {
  const { Input } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
  return {
    DateField: ({
      id,
      value,
      onChange,
      label,
    }: {
      id: string;
      value: string;
      onChange: (value: string) => void;
      label: string;
    }) => (
      <Input
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  };
});
vi.mock("@/fetchers/project/overview", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/project/overview")>();
  const pass =
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args);
  return {
    ...actual,
    listMilestones: pass(mocks.listMilestones),
    createMilestone: pass(mocks.createMilestone),
    updateMilestone: pass(mocks.updateMilestone),
    deleteMilestone: pass(mocks.deleteMilestone),
    listPrerequisites: pass(mocks.listPrerequisites),
    createPrerequisite: pass(mocks.createPrerequisite),
    updatePrerequisite: pass(mocks.updatePrerequisite),
    deletePrerequisite: pass(mocks.deletePrerequisite),
    listStakeholders: pass(mocks.listStakeholders),
    addStakeholder: pass(mocks.addStakeholder),
    standDownStakeholder: pass(mocks.standDownStakeholder),
    getProjectRoster: pass(mocks.getProjectRoster),
    listDocumentLinks: pass(mocks.listDocumentLinks),
    addDocumentLink: pass(mocks.addDocumentLink),
    deleteDocumentLink: pass(mocks.deleteDocumentLink),
  };
});

import { DocumentsPage } from "./documents-page";
import { MilestonesPanel } from "./milestones-panel";
import { PrerequisitesPage } from "./prerequisites-page";
import { TeamPage } from "./team-page";

function renderWith(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const goLive = {
  id: "m1",
  projectId: "p1",
  name: "Go-live",
  date: "2099-03-01T00:00:00.000Z",
  reachedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const vpn = {
  id: "r1",
  projectId: "p1",
  title: "Customer VPN access",
  ownerSide: "customer",
  dueDate: "2099-11-15T00:00:00.000Z",
  isBlocking: true,
  completedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const mia = {
  id: "s1",
  projectId: "p1",
  personId: "person-1",
  role: "Project manager",
  escalationOrder: 1,
  escalationWaitMinutes: 30,
  displayName: "Mia Manager",
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const roster = {
  members: [
    {
      personId: "person-2",
      displayName: "Sam Support",
      active: true,
      jobTitle: null,
      roleId: "role-member",
      roleKey: "member",
      roleName: "Member",
      roleRank: 2,
      source: "direct",
      inheritedFrom: null,
      overridesInherited: null,
      managedExternally: false,
      removable: true,
    },
  ],
  roles: [],
  callerRank: 3,
};
const sow = {
  id: "d1",
  projectId: "p1",
  url: "https://docs.example.test/sow",
  title: "Statement of work",
  customerVisible: true,
  createdAt: "2026-10-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canUpdate = true;
  mocks.listMilestones.mockResolvedValue([goLive]);
  mocks.listPrerequisites.mockResolvedValue([vpn]);
  mocks.listStakeholders.mockResolvedValue([mia]);
  mocks.getProjectRoster.mockResolvedValue(roster);
  mocks.listDocumentLinks.mockResolvedValue([sow]);
});
afterEach(() => cleanup());

describe("MilestonesPanel writes", () => {
  it("adds a milestone with the name and a midnight-UTC date", async () => {
    mocks.createMilestone.mockResolvedValue({ ...goLive, id: "m2" });
    renderWith(<MilestonesPanel projectId="p1" canUpdate />);
    fireEvent.click(
      await screen.findByRole("button", { name: "milestones.add" }),
    );
    type("milestones.name", "  Hand-over  ");
    type("milestones.date", "2099-05-01");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(mocks.createMilestone).toHaveBeenCalledWith("p1", {
        name: "Hand-over",
        date: "2099-05-01T00:00:00.000Z",
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("milestones.saved"),
    );
  });

  it("keeps the dialog open and shows the refusal when the save fails", async () => {
    mocks.createMilestone.mockRejectedValue(new HttpError(403, "Forbidden"));
    renderWith(<MilestonesPanel projectId="p1" canUpdate />);
    fireEvent.click(
      await screen.findByRole("button", { name: "milestones.add" }),
    );
    type("milestones.name", "Hand-over");
    type("milestones.date", "2099-05-01");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("common.forbidden")).toBeTruthy();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("marks a milestone reached from its row menu", async () => {
    mocks.updateMilestone.mockResolvedValue({ ...goLive, reachedAt: "x" });
    renderWith(<MilestonesPanel projectId="p1" canUpdate />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'common.actionsFor {"name":"Go-live"}',
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "milestones.markReached" }),
    );
    await waitFor(() =>
      expect(mocks.updateMilestone).toHaveBeenCalledWith("p1", "m1", {
        reached: true,
      }),
    );
  });

  it("offers no write control without project:update", async () => {
    renderWith(<MilestonesPanel projectId="p1" canUpdate={false} />);
    await screen.findByText("Go-live");
    expect(screen.queryByRole("button", { name: "milestones.add" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: 'common.actionsFor {"name":"Go-live"}',
      }),
    ).toBeNull();
  });
});

describe("PrerequisitesPage writes", () => {
  it("adds a blocking customer prerequisite with its due date", async () => {
    mocks.createPrerequisite.mockResolvedValue({ ...vpn, id: "r2" });
    renderWith(<PrerequisitesPage projectKey="HELP" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "prerequisites.add" }),
    );
    type("prerequisites.fieldTitle", "Firewall rule");
    type("prerequisites.fieldDue", "2099-12-01");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "prerequisites.add" }),
    );
    await waitFor(() =>
      expect(mocks.createPrerequisite).toHaveBeenCalledWith("p1", {
        title: "Firewall rule",
        ownerSide: "customer",
        dueDate: "2099-12-01T00:00:00.000Z",
        isBlocking: true,
      }),
    );
  });

  it("ticks a prerequisite done, and shows the error when the tick is refused", async () => {
    mocks.updatePrerequisite.mockResolvedValueOnce({
      ...vpn,
      completedAt: "2026-11-01T00:00:00.000Z",
    });
    renderWith(<PrerequisitesPage projectKey="HELP" />);
    const box = await screen.findByRole("checkbox", {
      name: 'prerequisites.markDone {"title":"Customer VPN access"}',
    });
    fireEvent.click(box);
    await waitFor(() =>
      expect(mocks.updatePrerequisite).toHaveBeenCalledWith("p1", "r1", {
        completed: true,
      }),
    );

    mocks.updatePrerequisite.mockRejectedValueOnce(new HttpError(500, "boom"));
    await waitFor(() => expect(box).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(box);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("common.failed"),
    );
  });

  it("shows status icons, not checkboxes or menus, without project:update", async () => {
    mocks.canUpdate = false;
    renderWith(<PrerequisitesPage projectKey="HELP" />);
    await screen.findByText("Customer VPN access");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "prerequisites.add" }),
    ).toBeNull();
    expect(
      screen.getByRole("img", { name: "prerequisites.statusOpen" }),
    ).toBeTruthy();
  });
});

describe("TeamPage writes", () => {
  async function openStandDown() {
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'common.actionsFor {"name":"Mia Manager"}',
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "team.standDown" }),
    );
    return screen.findByRole("alertdialog");
  }

  it("asks before standing a stakeholder down, and Cancel changes nothing", async () => {
    renderWith(<TeamPage projectKey="HELP" />);
    const confirm = await openStandDown();
    expect(confirm).toHaveTextContent(
      'team.standDownTitle {"name":"Mia Manager"}',
    );
    expect(confirm).toHaveTextContent(
      'team.standDownDescription {"name":"Mia Manager"}',
    );
    expect(mocks.standDownStakeholder).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "common.cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.standDownStakeholder).not.toHaveBeenCalled();
  });

  it("stands the stakeholder down only on confirm", async () => {
    mocks.standDownStakeholder.mockResolvedValue({ ...mia, active: false });
    renderWith(<TeamPage projectKey="HELP" />);
    const confirm = await openStandDown();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "team.standDownConfirm" }),
    );
    await waitFor(() =>
      expect(mocks.standDownStakeholder).toHaveBeenCalledWith("p1", "s1"),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("team.stoodDownToast"),
    );
  });

  it("shows the refusal when the stand-down fails", async () => {
    mocks.standDownStakeholder.mockRejectedValue(new HttpError(403, "no"));
    renderWith(<TeamPage projectKey="HELP" />);
    const confirm = await openStandDown();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "team.standDownConfirm" }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("common.forbidden"),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("adds a stakeholder from the roster at the next escalation order", async () => {
    mocks.addStakeholder.mockResolvedValue({ ...mia, id: "s2" });
    renderWith(<TeamPage projectKey="HELP" />);
    fireEvent.click(await screen.findByRole("button", { name: "team.add" }));
    type("team.role", "Service owner");
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "team.add" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "team.add" }));
    await waitFor(() =>
      expect(mocks.addStakeholder).toHaveBeenCalledWith("p1", {
        personId: "person-2",
        role: "Service owner",
        escalationOrder: 2,
        escalationWaitMinutes: 0,
      }),
    );
  });

  it("offers no add or stand-down control without project:update", async () => {
    mocks.canUpdate = false;
    renderWith(<TeamPage projectKey="HELP" />);
    await screen.findByText("Mia Manager");
    expect(screen.queryByRole("button", { name: "team.add" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: 'common.actionsFor {"name":"Mia Manager"}',
      }),
    ).toBeNull();
  });
});

describe("DocumentsPage writes", () => {
  it("adds a staff-only link by default, trimmed", async () => {
    mocks.addDocumentLink.mockResolvedValue({ ...sow, id: "d2" });
    renderWith(<DocumentsPage projectKey="HELP" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "documents.add" }),
    );
    type("documents.fieldTitle", " Runbook ");
    type("documents.fieldUrl", " https://docs.example.test/runbook ");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "documents.add" }),
    );
    await waitFor(() =>
      expect(mocks.addDocumentLink).toHaveBeenCalledWith("p1", {
        title: "Runbook",
        url: "https://docs.example.test/runbook",
        customerVisible: false,
      }),
    );
  });

  it("refuses a URL that is not http(s) before sending anything", async () => {
    renderWith(<DocumentsPage projectKey="HELP" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "documents.add" }),
    );
    type("documents.fieldTitle", "Runbook");
    type("documents.fieldUrl", "javascript:alert(1)");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "documents.urlInvalid",
    );
    expect(
      within(dialog).getByRole("button", { name: "documents.add" }),
    ).toBeDisabled();
    expect(mocks.addDocumentLink).not.toHaveBeenCalled();
  });

  it("shows the server's refusal in the dialog", async () => {
    mocks.addDocumentLink.mockRejectedValue(
      new HttpError(422, "url_not_allowed"),
    );
    renderWith(<DocumentsPage projectKey="HELP" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "documents.add" }),
    );
    type("documents.fieldTitle", "Runbook");
    type("documents.fieldUrl", "https://docs.example.test/runbook");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "documents.add" }),
    );
    expect(await within(dialog).findByText("url_not_allowed")).toBeTruthy();
  });

  it("deletes through a pending action", async () => {
    const pending = { id: "pa1" };
    mocks.deleteDocumentLink.mockResolvedValue(pending);
    renderWith(<DocumentsPage projectKey="HELP" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'common.actionsFor {"name":"Statement of work"}',
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "common.delete" }),
    );
    await waitFor(() =>
      expect(mocks.deleteDocumentLink).toHaveBeenCalledWith("p1", "d1"),
    );
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith(pending),
    );
  });

  it("offers no add or delete control without project:update", async () => {
    mocks.canUpdate = false;
    renderWith(<DocumentsPage projectKey="HELP" />);
    await screen.findByText("Statement of work");
    expect(screen.queryByRole("button", { name: "documents.add" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: 'common.actionsFor {"name":"Statement of work"}',
      }),
    ).toBeNull();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expectNoA11yViolations } from "@taskdesk/ui/test/a11y";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PortalProjectDetail,
  PortalProjectOption,
} from "@/fetchers/portal/projects";
import { HttpError } from "@/lib/http-error";
import { PortalProjectDetails } from "./portal-project-details";
import { PortalProjectsCards } from "./portal-projects-cards";
import { PortalProjectsList } from "./portal-projects-list";

const navigate = vi.hoisted(() => vi.fn());
const getPortalProjects = vi.hoisted(() => vi.fn());
const getPortalProject = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useNavigate: () => navigate,
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement> & {
        to: string;
        params?: Record<string, string>;
      }
    >(({ children, to, params, ...props }, ref) => (
      <a
        href={
          params?.projectKey ? to.replace("$projectKey", params.projectKey) : to
        }
        ref={ref}
        {...props}
      >
        {children}
      </a>
    )),
  };
});

vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options
        ? `${key}(${Object.entries(options)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(",")})`
        : key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));

vi.mock("@/fetchers/portal/projects", () => ({
  getPortalProjects,
  getPortalProject,
  portalProjectKeys: {
    list: () => ["portal", "projects", "list"],
    detail: (key: string) => ["portal", "projects", "detail", key],
  },
}));

const option = (
  overrides: Partial<PortalProjectOption> = {},
): PortalProjectOption => ({
  key: "CON",
  name: "Contoso rollout",
  kind: "project",
  status: "active",
  health: "green",
  counts: { actionRequired: 2, outstanding: 5 },
  ...overrides,
});

const detail = (
  overrides: Partial<PortalProjectDetail> = {},
): PortalProjectDetail => ({
  ...option(),
  description: "Customer onboarding programme",
  createdAt: "2026-01-05T09:00:00.000Z",
  supportLevel: "L2",
  serviceCalendarName: "Business hours",
  summary: {
    objective: "Go live on the new portal",
    inScope: "Migration",
    outOfScope: null,
    successCriteria: "All users migrated",
  },
  goLive: { name: "Launch", date: "2026-06-30T00:00:00.000Z", reached: false },
  milestones: [
    {
      id: "m1",
      name: "Kick-off",
      date: "2026-01-10T00:00:00.000Z",
      reachedAt: "2026-01-10T00:00:00.000Z",
    },
    {
      id: "m2",
      name: "Launch",
      date: "2026-06-30T00:00:00.000Z",
      reachedAt: null,
    },
  ],
  prerequisites: [
    {
      id: "p1",
      title: "Provide VPN access",
      dueDate: "2026-02-01T00:00:00.000Z",
      completedAt: null,
    },
  ],
  documents: [
    { id: "d1", title: "Statement of work", url: "https://docs.example/sow" },
    { id: "d2", title: "Script link", url: "javascript:alert(1)" },
  ],
  contacts: [
    {
      kind: "manager",
      role: null,
      name: "Mara Manager",
      email: "mara@example.test",
    },
    {
      kind: "stakeholder",
      role: "Technical lead",
      name: "Sam Stakeholder",
      email: null,
    },
  ],
  contract: {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    period: {
      state: "active",
      totalDays: 365,
      elapsedDays: 100,
      daysRemaining: 265,
      elapsedPct: 27,
    },
    hours: {
      contractedMinutes: 6000,
      usedMinutes: 1530,
      remainingMinutes: 4470,
      usedPct: 26,
    },
  },
  ...overrides,
});

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  getPortalProjects.mockReset();
  getPortalProject.mockReset();
});

describe("PortalProjectsList", () => {
  const projects = [
    option(),
    option({
      key: "OPS",
      name: "Managed operations",
      kind: "managed_service",
      status: "on_hold",
      health: "amber",
      counts: { actionRequired: 0, outstanding: 1 },
    }),
  ];

  it("lists key, name, type, status and both counts, linking each project", async () => {
    getPortalProjects.mockResolvedValue({ data: projects });
    wrap(<PortalProjectsList search={{}} />);
    const link = await screen.findByRole("link", { name: "Contoso rollout" });
    expect(link).toHaveAttribute("href", "/projects/CON");
    const row = link.closest("tr") as HTMLElement;
    expect(within(row).getByText("CON")).toBeInTheDocument();
    expect(within(row).getByText("projects.kind.project")).toBeInTheDocument();
    expect(within(row).getByText("projects.status.active")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("5")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Managed operations" }),
    ).toBeInTheDocument();
  });

  it("filters by the tab and the search in the URL", async () => {
    getPortalProjects.mockResolvedValue({ data: projects });
    const { unmount } = wrap(
      <PortalProjectsList search={{ tab: "services" }} />,
    );
    expect(
      await screen.findByRole("link", { name: "Managed operations" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Contoso rollout" })).toBeNull();
    unmount();
    wrap(<PortalProjectsList search={{ q: "con" }} />);
    expect(
      await screen.findByRole("link", { name: "Contoso rollout" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Managed operations" }),
    ).toBeNull();
  });

  it("writes the search to the URL and offers to clear a search with no match", async () => {
    getPortalProjects.mockResolvedValue({ data: projects });
    wrap(<PortalProjectsList search={{}} />);
    await screen.findByRole("link", { name: "Contoso rollout" });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "projects.search.label" }),
      { target: { value: "zzz" } },
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/projects", replace: true }),
    );
    const call = navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ project: "CON" })).toEqual({
      project: "CON",
      tab: undefined,
      q: "zzz",
    });
    expect(
      await screen.findByText("projects.noMatches.title"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "projects.search.clear" }),
    );
    expect(
      await screen.findByRole("link", { name: "Contoso rollout" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state and a retry on failure", async () => {
    getPortalProjects.mockResolvedValue({ data: [] });
    const { unmount } = wrap(<PortalProjectsList search={{}} />);
    expect(await screen.findByText("projects.empty.title")).toBeInTheDocument();
    unmount();
    getPortalProjects.mockRejectedValueOnce(new Error("down"));
    getPortalProjects.mockResolvedValueOnce({ data: projects });
    wrap(<PortalProjectsList search={{}} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "common:actions.tryAgain" }),
    );
    expect(
      await screen.findByRole("link", { name: "Contoso rollout" }),
    ).toBeInTheDocument();
  });

  it("has no serious or critical axe violations (G4)", async () => {
    getPortalProjects.mockResolvedValue({ data: projects });
    const { container } = wrap(<PortalProjectsList search={{}} />);
    await screen.findByRole("link", { name: "Contoso rollout" });
    await expectNoA11yViolations(container);
  });
});

describe("PortalProjectsCards (Dashboard)", () => {
  const projects = [
    option(),
    option({
      key: "OPS",
      name: "Managed operations",
      kind: "managed_service",
      status: "on_hold",
      health: "amber",
      counts: { actionRequired: 0, outstanding: 1 },
    }),
  ];

  it("shows a card per project with status, health and both counts, linking each project", async () => {
    getPortalProjects.mockResolvedValue({ data: projects });
    wrap(<PortalProjectsCards />);
    const link = await screen.findByRole("link", { name: "Contoso rollout" });
    expect(link).toHaveAttribute("href", "/projects/CON");
    const card = link.closest("li") as HTMLElement;
    expect(within(card).getByText("CON")).toBeInTheDocument();
    expect(within(card).getByText("projects.kind.project")).toBeInTheDocument();
    expect(
      within(card).getByText("projects.status.active"),
    ).toBeInTheDocument();
    expect(within(card).getByText("projects.health.green")).toBeInTheDocument();
    expect(within(card).getByText("2")).toBeInTheDocument();
    expect(within(card).getByText("5")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Managed operations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "projects.dashboard.viewAll" }),
    ).toHaveAttribute("href", "/projects");
  });

  it("shows only the selected project's card when the dashboard is scoped", async () => {
    getPortalProjects.mockResolvedValue({ data: projects });
    wrap(<PortalProjectsCards projectKey="OPS" />);
    expect(
      await screen.findByRole("link", { name: "Managed operations" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Contoso rollout" })).toBeNull();
  });

  it("renders nothing for an organisation with no projects and retries a failed load", async () => {
    getPortalProjects.mockResolvedValue({ data: [] });
    const { container, unmount } = wrap(<PortalProjectsCards />);
    await vi.waitFor(() => expect(getPortalProjects).toHaveBeenCalled());
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
    unmount();
    getPortalProjects.mockRejectedValueOnce(new Error("down"));
    getPortalProjects.mockResolvedValueOnce({ data: projects });
    wrap(<PortalProjectsCards />);
    expect(await screen.findByText("projects.loadFailed")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.retry" }),
    );
    expect(
      await screen.findByRole("link", { name: "Contoso rollout" }),
    ).toBeInTheDocument();
  });

  it("has no serious or critical axe violations (G4)", async () => {
    getPortalProjects.mockResolvedValue({ data: projects });
    const { container } = wrap(<PortalProjectsCards />);
    await screen.findByRole("link", { name: "Contoso rollout" });
    await expectNoA11yViolations(container);
  });
});

describe("PortalProjectDetails", () => {
  it("shows information, contacts, subscription period, hours and the engagement", async () => {
    getPortalProject.mockResolvedValue(detail());
    wrap(<PortalProjectDetails projectKey="CON" />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Contoso rollout" }),
    ).toBeInTheDocument();
    expect(screen.getByText("L2")).toBeInTheDocument();
    expect(screen.getByText("Business hours")).toBeInTheDocument();
    expect(screen.getByText("Jun 30, 2026")).toBeInTheDocument();
    const email = screen.getByRole("link", {
      name: "projects.detail.contacts.emailLabel(name=Mara Manager)",
    });
    expect(email).toHaveAttribute("href", "mailto:mara@example.test");
    expect(screen.getByText("Technical lead")).toBeInTheDocument();
    expect(
      screen.getByText("projects.detail.subscription.remaining(count=265)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "projects.detail.subscription.progressLabel",
      }),
    ).toHaveAttribute("aria-valuenow", "27");
    expect(
      screen.getByText("projects.detail.hours.usedOf(used=25.5,total=100)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("projects.detail.hours.remaining(hours=74.5)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Go live on the new portal")).toBeInTheDocument();
    expect(screen.queryByText("projects.detail.summary.outOfScope")).toBeNull();
    expect(screen.getByText("Provide VPN access")).toBeInTheDocument();
  });

  it("opens documents safely and never links a non-web URL", async () => {
    getPortalProject.mockResolvedValue(detail());
    wrap(<PortalProjectDetails projectKey="CON" />);
    const document = await screen.findByRole("link", {
      name: /Statement of work/u,
    });
    expect(document).toHaveAttribute("href", "https://docs.example/sow");
    expect(document).toHaveAttribute("target", "_blank");
    expect(document).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Script link").closest("a")).toBeNull();
  });

  it("states an overdrawn allocation and a missing contract", async () => {
    getPortalProject.mockResolvedValue(
      detail({
        contract: {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          period: {
            state: "ended",
            totalDays: 31,
            elapsedDays: 31,
            daysRemaining: 0,
            elapsedPct: 100,
          },
          hours: {
            contractedMinutes: 60,
            usedMinutes: 210,
            remainingMinutes: -150,
            usedPct: 350,
          },
        },
      }),
    );
    const { unmount } = wrap(<PortalProjectDetails projectKey="CON" />);
    expect(
      await screen.findByText("projects.detail.hours.overdrawn(hours=2.5)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("projects.detail.subscription.ended(date=Jan 31, 2026)"),
    ).toBeInTheDocument();
    unmount();
    getPortalProject.mockResolvedValue(detail({ contract: null }));
    wrap(<PortalProjectDetails projectKey="CON" />);
    expect(
      await screen.findByText("projects.detail.subscription.none"),
    ).toBeInTheDocument();
    expect(screen.getByText("projects.detail.hours.none")).toBeInTheDocument();
  });

  it("shows not found for a project outside the organisation (CP-2)", async () => {
    getPortalProject.mockRejectedValue(new HttpError(404, "Project not found"));
    wrap(<PortalProjectDetails projectKey="OTHER" />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "projects.detail.notFound.title",
      }),
    ).toBeInTheDocument();
    expect(getPortalProject).toHaveBeenCalledTimes(1);
  });

  it("has no serious or critical axe violations (G4)", async () => {
    getPortalProject.mockResolvedValue(detail());
    const { container } = wrap(<PortalProjectDetails projectKey="CON" />);
    await screen.findByRole("heading", { level: 1, name: "Contoso rollout" });
    await expectNoA11yViolations(container);
  });
});

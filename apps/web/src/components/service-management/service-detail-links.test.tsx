import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceDetail } from "@/fetchers/service-management";
import { headingLevels } from "@/test/headings";

const mocks = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; slug: string; name: string }>,
  getProjectsArgs: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: (...args: unknown[]) => {
    mocks.getProjectsArgs(...args);
    return { data: mocks.projects };
  },
}));
vi.mock("@/hooks/queries/kb", () => ({
  useKbArticles: () => ({ data: { articles: [] } }),
}));
vi.mock("@/hooks/queries/service-management", () => ({
  useInvalidateServiceManagement: () => vi.fn(),
  useCatalogueStatus: vi.fn(),
  useService: vi.fn(),
  useServiceImpact: vi.fn(),
  useServices: vi.fn(),
  isFeatureDisabled: (error: unknown) =>
    (error as { status?: number } | null)?.status === 409,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageWorkspaceSettings: () => false }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));

import * as serviceQueries from "@/hooks/queries/service-management";
import { HttpError } from "@/lib/http-error";
import { LinksCard, ServiceDetailView } from "./service-detail";

function projectLink(id: string, name: string) {
  return {
    id: `link-${id}`,
    kind: "project" as const,
    label: null,
    url: null,
    projectId: id,
    projectName: name,
    kbArticleId: null,
  };
}

function renderCard(canManage: boolean) {
  const service = {
    id: "s1",
    links: [
      projectLink("p-acme", "Acme support"),
      projectLink("p-hidden", "Globex support"),
    ],
  } as unknown as ServiceDetail;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LinksCard service={service} workspaceId="w1" canManage={canManage} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.projects = [];
  mocks.getProjectsArgs.mockClear();
});

describe("Service detail project links (S5)", () => {
  it("links a reachable project to its page and leaves an unreachable one as text", () => {
    // The project list is reach-filtered: only Acme support is visible to this reader.
    mocks.projects = [{ id: "p-acme", slug: "ACME", name: "Acme support" }];
    renderCard(false);

    const link = screen.getByTestId("service-link-project");
    expect(link.getAttribute("href")).toBe("/agent/projects/ACME");
    expect(link.textContent).toBe("Acme support");
    expect(screen.getAllByTestId("service-link-project")).toHaveLength(1);
    const hidden = screen.getByText("Globex support");
    expect(hidden.closest("a")).toBeNull();
  });

  it("loads the project list for readers who cannot manage links", () => {
    renderCard(false);
    expect(mocks.getProjectsArgs).toHaveBeenCalledWith({ workspaceId: "w1" });
  });
});

describe("Service detail unknown service", () => {
  it("shows not-found without Retry when the service id does not exist (404)", () => {
    vi.mocked(serviceQueries.useCatalogueStatus).mockReturnValue({
      data: { canManageServices: false },
    } as never);
    vi.mocked(serviceQueries.useService).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new HttpError(404, "Service not found"),
      refetch: vi.fn(),
    } as never);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ServiceDetailView serviceId="bogus" />
      </QueryClientProvider>,
    );
    expect(
      screen.getByTestId("service-management-not-found"),
    ).toHaveTextContent("services.detail.notFound");
    expect(
      screen.queryByRole("button", { name: /common.retry/ }),
    ).not.toBeInTheDocument();
  });

  // UX-1a: with the catalogue off the page keeps its title as the one h1 and the off state sits
  // under it as h2.
  it("keeps one h1 with the catalogue-off state under it when the catalogue is off (409)", () => {
    vi.mocked(serviceQueries.useCatalogueStatus).mockReturnValue({
      data: { canManageServices: false },
    } as never);
    vi.mocked(serviceQueries.useService).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new HttpError(409, "feature_disabled"),
      refetch: vi.fn(),
    } as never);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ServiceDetailView serviceId="s1" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("service-catalogue-off")).toBeInTheDocument();
    expect(headingLevels()).toEqual([1, 2]);
  });
});

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import { useContext } from "react";
import { I18nContext, I18nextProvider, useTranslation } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installAgentTerminology } from "./agent-translation";

const terminologyMocks = vi.hoisted(() => ({
  portal: vi.fn(),
  public: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("@/fetchers/terminology", () => ({
  getPortalTerminology: terminologyMocks.portal,
  getPublicTerminology: terminologyMocks.public,
  getWorkspaceRuntimeTerminology: terminologyMocks.workspace,
}));

afterEach(() => vi.restoreAllMocks());

import * as i18nModule from "./index";
import {
  installAudienceTerms,
  mergeAudienceTerms,
  TerminologyProvider,
} from "./terminology-provider";

function ProviderProbe() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (
    <>
      <output data-testid="noun">
        {t("customer.request", { ns: "term", count: 1 })}
      </output>
      <Button
        type="button"
        onClick={() =>
          void queryClient.invalidateQueries({
            queryKey: [
              "terminology-runtime",
              "customer",
              "en-US",
              null,
              { requestTypeKey: "help_request" },
            ],
          })
        }
      >
        Refetch terminology
      </Button>
    </>
  );
}

function AgentProviderProbe() {
  const { t } = useTranslation();
  const i18n = useContext(I18nContext)?.i18n;
  return (
    <>
      <output data-testid="agent-noun">
        {t("a11y.taskContainerLabel", {
          ns: "common",
          key: "HELP-1",
          title: "Example",
        })}
      </output>
      <output data-testid="agent-context-noun">
        {i18n?.t("a11y.taskContainerLabel", {
          ns: "common",
          key: "HELP-1",
          title: "Example",
        })}
      </output>
    </>
  );
}

function NestedAgentProviderProbe({ workspaceId }: { workspaceId: string }) {
  return (
    <TerminologyProvider
      audience="agent"
      locale="en-US"
      workspaceId={workspaceId}
    >
      <AgentProviderProbe />
    </TerminologyProvider>
  );
}

describe("terminology resource overlays", () => {
  it("updates only the selected audience and leaves shipped resources unchanged", () => {
    const shipped = {
      agent: { request_one: "Request" },
      customer: { request_one: "Request" },
    };

    const agent = mergeAudienceTerms(shipped, "agent", {
      request: { one: "Case", other: "Cases" },
    });

    expect(agent.agent).toEqual({
      request_one: "Case",
      request_other: "Cases",
    });
    expect(agent.customer).toEqual({ request_one: "Request" });
    expect(shipped.agent).toEqual({ request_one: "Request" });
    expect(shipped.customer).toEqual({ request_one: "Request" });
  });

  it("isolates actual forked stores across workspaces, audiences and shipped defaults", async () => {
    const base = createInstance();
    const shipped = {
      agent: { request_one: "Request", request_other: "Requests" },
      customer: { request_one: "Request", request_other: "Requests" },
    };
    await base.init({
      lng: "en-US",
      resources: { "en-US": { term: shipped } },
    });
    const workspaceA = base.cloneInstance({ forkResourceStore: true });
    const workspaceB = base.cloneInstance({ forkResourceStore: true });
    const staff = base.cloneInstance({ forkResourceStore: true });
    installAudienceTerms(workspaceA, "en-US", shipped, "customer", {
      request: { one: "Case", other: "Cases" },
    });
    installAudienceTerms(workspaceB, "en-US", shipped, "customer", {
      request: { one: "Ticket", other: "Tickets" },
    });
    installAudienceTerms(staff, "en-US", shipped, "agent", {
      request: { one: "Issue", other: "Issues" },
    });
    const noun = (instance: typeof base, audience: string) =>
      instance.t(`${audience}.request`, { ns: "term", count: 1 });
    expect(noun(workspaceA, "customer")).toBe("Case");
    expect(noun(workspaceB, "customer")).toBe("Ticket");
    expect(noun(staff, "agent")).toBe("Issue");
    expect(noun(staff, "customer")).toBe("Request");
    expect(noun(base, "customer")).toBe("Request");
    expect(noun(base, "agent")).toBe("Request");
    expect(shipped.customer.request_one).toBe("Request");
    // Clearing a scope uses shipped values, not another workspace's last override.
    installAudienceTerms(workspaceA, "en-US", shipped, "customer", {});
    expect(noun(workspaceA, "customer")).toBe("Request");
    expect(noun(workspaceB, "customer")).toBe("Ticket");
  });

  it("preserves the other audience when customer forms are overlaid", () => {
    const shipped = {
      agent: { request_one: "Request" },
      customer: { request_one: "Request" },
    };
    const customer = mergeAudienceTerms(shipped, "customer", {
      request: { one: "Case", other: "Cases" },
    });

    expect(customer.customer).toEqual({
      request_one: "Case",
      request_other: "Cases",
    });
    expect(customer.agent).toEqual({ request_one: "Request" });
  });

  it("clears a same-scope customer override back to pristine shipped terms", async () => {
    terminologyMocks.portal
      .mockResolvedValueOnce({
        terms: { request: { one: "Case", other: "Cases" } },
      })
      .mockResolvedValueOnce({ terms: {} });
    terminologyMocks.public.mockResolvedValue({ terms: {} });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { getByRole, unmount } = render(
      <QueryClientProvider client={queryClient}>
        <TerminologyProvider
          audience="customer"
          locale="en-US"
          portalSelector={{ requestTypeKey: "help_request" }}
        >
          <ProviderProbe />
        </TerminologyProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("noun")).toHaveTextContent("Case"),
    );
    await act(async () => {
      getByRole("button", { name: "Refetch terminology" }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("noun")).toHaveTextContent("Request"),
    );
    expect(terminologyMocks.portal).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("installs agent terminology before publishing the scoped provider", async () => {
    terminologyMocks.workspace.mockResolvedValue({ terms: {} });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <TerminologyProvider
          audience="agent"
          locale="en-US"
          workspaceId="workspace-a"
        >
          <AgentProviderProbe />
        </TerminologyProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("agent-noun")).toHaveTextContent(
        "Work item HELP-1: Example",
      ),
    );
    unmount();
  });

  it("keeps inherited instance terms visible while nested workspace clones load or change", async () => {
    terminologyMocks.workspace
      .mockReset()
      .mockImplementation(async (workspaceId: string) => ({
        terms: {
          work_item: {
            one: `Workspace ${workspaceId === "workspace-a" ? "A" : "B"} case`,
            other: `Workspace ${workspaceId === "workspace-a" ? "A" : "B"} cases`,
          },
        },
      }));

    const parentI18n = createInstance();
    await parentI18n.init({
      lng: "en-US",
      defaultNS: "common",
      resources: {
        "en-US": {
          common: {
            a11y: {
              taskContainerLabel: "{{term_work_item_one}} {{key}}: {{title}}",
            },
          },
          term: {
            agent: {
              work_item_one: "Instance case",
              work_item_other: "Instance cases",
            },
          },
        },
      },
      interpolation: { skipOnVariables: true },
    });
    installAgentTerminology(parentI18n);

    const originalCreateScopedI18n = i18nModule.createScopedI18n;
    let releaseCloneA!: () => void;
    let releaseCloneB!: () => void;
    const cloneDelayA = new Promise<void>((resolve) => {
      releaseCloneA = resolve;
    });
    const cloneDelayB = new Promise<void>((resolve) => {
      releaseCloneB = resolve;
    });
    let cloneCount = 0;
    const cloneSpy = vi
      .spyOn(i18nModule, "createScopedI18n")
      .mockImplementation(async (locale, namespaces) => {
        cloneCount += 1;
        await (cloneCount === 1 ? cloneDelayA : cloneDelayB);
        return originalCreateScopedI18n(locale, namespaces);
      });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (workspaceId: string) => (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={parentI18n}>
          <NestedAgentProviderProbe workspaceId={workspaceId} />
        </I18nextProvider>
      </QueryClientProvider>
    );
    const view = render(tree("workspace-a"));

    await waitFor(() =>
      expect(screen.getByTestId("agent-noun")).toHaveTextContent(
        "Instance case HELP-1: Example",
      ),
    );
    expect(terminologyMocks.workspace).toHaveBeenCalledWith(
      "workspace-a",
      "en-US",
    );

    await act(async () => {
      releaseCloneA();
    });
    await waitFor(() =>
      expect(screen.getByTestId("agent-noun")).toHaveTextContent(
        "Workspace A case HELP-1: Example",
      ),
    );
    expect(parentI18n.t("agent.work_item", { ns: "term", count: 1 })).toBe(
      "Instance case",
    );

    view.rerender(tree("workspace-b"));
    await waitFor(() =>
      expect(terminologyMocks.workspace).toHaveBeenCalledWith(
        "workspace-b",
        "en-US",
      ),
    );
    expect(screen.getByTestId("agent-context-noun")).toHaveTextContent(
      "Instance case HELP-1: Example",
    );
    await waitFor(() =>
      expect(screen.getByTestId("agent-noun")).toHaveTextContent(
        "Instance case HELP-1: Example",
      ),
    );
    expect(screen.getByTestId("agent-noun")).not.toHaveTextContent(
      "Workspace A case",
    );
    await act(async () => {
      releaseCloneB();
    });
    await waitFor(() =>
      expect(screen.getByTestId("agent-noun")).toHaveTextContent(
        "Workspace B case HELP-1: Example",
      ),
    );
    expect(screen.getByTestId("agent-noun")).not.toHaveTextContent(
      "Workspace A case",
    );
    cloneSpy.mockRestore();
  });

  it("uses the outer instance terms while a targetless approval boundary loads inside another workspace", async () => {
    terminologyMocks.public.mockResolvedValue({
      terms: {
        work_item: { one: "Instance case", other: "Instance cases" },
      },
    });
    terminologyMocks.workspace.mockImplementation(
      async (workspaceId: string) => ({
        terms: {
          work_item: {
            one:
              workspaceId === "active-workspace"
                ? "Active case"
                : "Target case",
            other:
              workspaceId === "active-workspace"
                ? "Active cases"
                : "Target cases",
          },
        },
      }),
    );

    const originalCreateScopedI18n = i18nModule.createScopedI18n;
    let releaseTargetClone!: () => void;
    const targetCloneDelay = new Promise<void>((resolve) => {
      releaseTargetClone = resolve;
    });
    let cloneCount = 0;
    const cloneSpy = vi
      .spyOn(i18nModule, "createScopedI18n")
      .mockImplementation(async (locale, namespaces) => {
        cloneCount += 1;
        if (cloneCount === 3) await targetCloneDelay;
        return originalCreateScopedI18n(locale, namespaces);
      });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (withTargetBoundary: boolean) => (
      <QueryClientProvider client={queryClient}>
        <TerminologyProvider audience="agent" locale="en-US">
          <TerminologyProvider
            audience="agent"
            locale="en-US"
            workspaceId="active-workspace"
          >
            <AgentProviderProbe />
            {withTargetBoundary && (
              <TerminologyProvider
                audience="agent"
                locale="en-US"
                workspaceId={null}
              >
                <AgentProviderProbe />
              </TerminologyProvider>
            )}
          </TerminologyProvider>
        </TerminologyProvider>
      </QueryClientProvider>
    );
    const view = render(tree(false));

    await waitFor(() =>
      expect(screen.getByTestId("agent-noun")).toHaveTextContent(
        "Active case HELP-1: Example",
      ),
    );
    view.rerender(tree(true));
    await waitFor(() => expect(cloneCount).toBe(3));

    const terms = screen.getAllByTestId("agent-noun");
    expect(terms.at(-1)).toHaveTextContent("Instance case HELP-1: Example");
    expect(terms.at(-1)).not.toHaveTextContent("Active case");

    await act(async () => releaseTargetClone());
    await waitFor(() =>
      expect(screen.getAllByTestId("agent-noun").at(-1)).toHaveTextContent(
        "Instance case HELP-1: Example",
      ),
    );
    cloneSpy.mockRestore();
  });
});

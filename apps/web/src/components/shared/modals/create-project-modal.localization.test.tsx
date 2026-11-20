/**
 * Real-i18next regression for the create-project success toast: the real modal, the real
 * `useAgentTranslation` hook and the real catalogs (en-US, ko-KR, mk-MK). Only the data hooks
 * around the modal are stand-ins. The fallback cases use the real `AppI18nProvider` and
 * `TerminologyProvider` while their isolated clone is pending or fails.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createInstance,
  type i18n as I18nInstance,
  type ResourceKey,
} from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installAgentTerminology,
  withAgentTerminology,
} from "@/lib/i18n/agent-translation";
import * as i18nModule from "@/lib/i18n/index";
import { AppI18nProvider } from "@/lib/i18n/provider";
import english from "../../../../../../i18n/en-US.json";
import korean from "../../../../../../i18n/ko-KR.json";
import macedonian from "../../../../../../i18n/mk-MK.json";
import CreateProjectModal from "./create-project-modal";

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  createProject: vi.fn(),
  publicTerminology: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/fetchers/terminology", () => ({
  getPortalTerminology: vi.fn(),
  getPublicTerminology: mocks.publicTerminology,
  getWorkspaceRuntimeTerminology: vi.fn(),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { locale: "en-US" } }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/queries/feature-flag/use-workspace-features", () => ({
  default: () => ({ isOn: () => false, isLoading: false }),
}));
vi.mock("@/hooks/queries/service-calendar/use-service-calendars", () => ({
  useServiceCalendars: () => ({
    data: { data: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1", name: "Ops" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canBindProjectOrganisation: () => false,
    canManageWorkspaceSettings: () => true,
  }),
}));
vi.mock("@/hooks/queries/project/use-customer-organisations", () => ({
  default: () => ({
    data: [],
    isPending: false,
    isSuccess: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/mutations/project/use-create-project", () => ({
  default: () => ({ mutateAsync: mocks.createProject, isPending: false }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { role: "user" } } }) },
}));

const queryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

type Catalog = { common: ResourceKey; term: ResourceKey };

async function isolatedInstance(
  locale: string,
  catalog: Catalog,
  renamed?: { one: string; other: string },
) {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: locale,
    ns: ["common", "term"],
    defaultNS: "common",
    interpolation: { escapeValue: false, skipOnVariables: true },
    // Cloned: addResourceBundle mutates in place and these JSON modules are shared with the app.
    resources: {
      [locale]: structuredClone({ common: catalog.common, term: catalog.term }),
    },
  });
  if (renamed)
    instance.addResourceBundle(
      locale,
      "term",
      { agent: { project_one: renamed.one, project_other: renamed.other } },
      true,
      true,
    );
  return instance;
}

function ModalUnderTest() {
  return <CreateProjectModal open onClose={vi.fn()} />;
}

/** Fill the name field and submit, using the labels the real catalog renders. */
function submit(instance: I18nInstance) {
  const label = withAgentTerminology(instance.t.bind(instance), instance);
  fireEvent.change(
    screen.getByPlaceholderText(
      label("common:modals.createProject.projectName"),
    ),
    { target: { value: "Acme support" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: label("common:modals.createProject.createButton"),
    }),
  );
}

beforeEach(() => {
  mocks.toastSuccess.mockClear();
  mocks.createProject.mockReset().mockResolvedValue({ id: "project-1" });
  mocks.publicTerminology.mockReset().mockResolvedValue({
    locale: "en-US",
    audience: "agent",
    terms: { project: { one: "Plan", other: "Plans" } },
    etag: "test-etag",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noPlaceholder = /\{\{\s*term/u;

describe("create-project success toast with real catalogs", () => {
  const locales = [
    {
      locale: "en-US",
      catalog: english,
      renamed: { one: "Plan", other: "Plans" },
      expected: (noun: string) => `${noun} created successfully`,
      nounKey: "project_one" as const,
      renamedNoun: "Plan",
    },
    {
      locale: "ko-KR",
      catalog: korean,
      renamed: { one: "계획", other: "계획" },
      expected: (noun: string) => `${noun} 생성이 완료되었습니다`,
      nounKey: "project_other" as const,
      renamedNoun: "계획",
    },
    {
      locale: "mk-MK",
      catalog: macedonian,
      renamed: { one: "План", other: "Планови" },
      expected: (noun: string) => `Успешно креирање на ${noun}`,
      nounKey: "project_one" as const,
      renamedNoun: "План",
    },
  ];

  it.each(
    locales.flatMap((entry) =>
      (["installed clone", "base fallback"] as const).flatMap((mode) =>
        (["default", "renamed"] as const).map((vocabulary) => ({
          ...entry,
          mode,
          vocabulary,
        })),
      ),
    ),
  )(
    "$locale renders the $vocabulary noun on the $mode with no raw placeholder",
    async ({
      locale,
      catalog,
      renamed,
      expected,
      nounKey,
      renamedNoun,
      mode,
      vocabulary,
    }) => {
      const instance = await isolatedInstance(
        locale,
        catalog,
        vocabulary === "renamed" ? renamed : undefined,
      );
      if (mode === "installed clone") installAgentTerminology(instance);
      const defaultNoun = (catalog.term as { agent: Record<string, string> })
        .agent[nounKey] as string;

      render(
        <QueryClientProvider client={queryClient()}>
          <I18nextProvider i18n={instance}>
            <ModalUnderTest />
          </I18nextProvider>
        </QueryClientProvider>,
      );
      submit(instance);

      await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
      const message = mocks.toastSuccess.mock.calls[0]?.[0] as string;
      expect(message).toBe(
        expected(vocabulary === "renamed" ? renamedNoun : defaultNoun),
      );
      expect(message).not.toMatch(noPlaceholder);
    },
  );
});

describe("create-project success toast through the real terminology provider", () => {
  function Probe() {
    const { t } = useTranslation();
    return (
      <output data-testid="noun">
        {t("agent.project", { ns: "term", count: 1 })}
      </output>
    );
  }

  function renderUnderAppProvider() {
    render(
      <QueryClientProvider client={queryClient()}>
        <AppI18nProvider>
          <Probe />
          <ModalUnderTest />
        </AppI18nProvider>
      </QueryClientProvider>,
    );
  }

  async function submitWithRealLabels() {
    await i18nModule.whenAllNamespacesLoaded();
    fireEvent.change(await screen.findByPlaceholderText(/ name$/u), {
      target: { value: "Acme support" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create / }));
  }

  it("shows the renamed noun once the isolated clone is installed", async () => {
    renderUnderAppProvider();
    await waitFor(() =>
      expect(screen.getByTestId("noun")).toHaveTextContent("Plan"),
    );
    await submitWithRealLabels();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Plan created successfully",
    );
  });

  it("falls back to the base instance noun, never a raw placeholder, while the clone is pending", async () => {
    vi.spyOn(i18nModule, "createScopedI18n").mockReturnValue(
      new Promise(() => {}),
    );
    renderUnderAppProvider();
    await submitWithRealLabels();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    const message = mocks.toastSuccess.mock.calls[0]?.[0] as string;
    expect(message).toBe("Project created successfully");
    expect(message).not.toMatch(noPlaceholder);
  });

  it("falls back to the base instance noun, never a raw placeholder, when the clone fails", async () => {
    vi.spyOn(i18nModule, "createScopedI18n").mockRejectedValue(
      new Error("clone failed"),
    );
    renderUnderAppProvider();
    await submitWithRealLabels();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    const message = mocks.toastSuccess.mock.calls[0]?.[0] as string;
    expect(message).toBe("Project created successfully");
    expect(message).not.toMatch(noPlaceholder);
  });
});

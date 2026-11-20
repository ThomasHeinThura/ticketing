import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sampleCountForCategory,
  TerminologyEditor,
} from "./terminology-editor";

const terminologyMocks = vi.hoisted(() => ({
  get: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({
    target,
  }: {
    target: { id: string; scope: { kind: string; workspaceId?: string } };
  }) => (
    <div
      data-testid="term-history"
      data-id={target.id}
      data-scope={target.scope.kind}
      data-workspace={target.scope.workspaceId}
    />
  ),
}));

vi.mock("@/fetchers/terminology", () => ({
  TERMINOLOGY_TERM_KEYS: [
    "work_item",
    "project",
    "cycle",
    "module",
    "epic",
    "request",
    "submission",
    "service",
    "change",
  ],
  getTerminology: terminologyMocks.get,
  previewTerminology: terminologyMocks.preview,
  saveTerminology: terminologyMocks.save,
}));

afterEach(() => {
  vi.clearAllMocks();
});

async function renderEditor(overrides: unknown[] = []) {
  terminologyMocks.get.mockResolvedValue({ overrides, etag: '"v1"' });
  const i18n = createInstance();
  await i18n.init({
    lng: "en-US",
    defaultNS: "settings",
    ns: ["settings", "term", "common"],
    resources: {
      "en-US": {
        settings: {
          terminology: {
            title: "Terminology",
            description: "Set the visible noun forms.",
            unavailable: "Unavailable",
            loadFailed: "Could not load terminology.",
            saveFailed: "Could not save terminology.",
            sameFormsWarning: "The one and other forms are identical.",
            audience: "Audience",
            audiences: {
              both: "Everyone",
              agent: "Staff",
              customer: "Customers",
            },
            term: "Term",
            locale: "Locale",
            categories: { one: "One", other: "Other" },
            useDefault: "Use default",
            preview: "Preview forms",
            livePreview: "Live screen preview",
            livePreviewDraft: "Draft preview. Save to apply these terms.",
            sampleAction: "Create {{noun}}",
          },
        },
        term: {
          agent: { request_one: "Request", request_other: "Requests" },
          customer: { request_one: "Request", request_other: "Requests" },
        },
        common: {
          actions: { save: "Save" },
          empty: { loading: "Saving" },
          retry: "Retry",
        },
      },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TerminologyEditor
          target={{ scope: "workspace", workspaceId: "workspace-a" }}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

describe("TerminologyEditor live preview", () => {
  it("finds representative large and fractional counts for CLDR categories", () => {
    const frenchMany = sampleCountForCategory("fr-FR", "many");
    const russianOther = sampleCountForCategory("ru-RU", "other");

    expect(new Intl.PluralRules("fr-FR").select(frenchMany)).toBe("many");
    expect(frenchMany).toBe(1_000_000);
    expect(new Intl.PluralRules("ru-RU").select(russianOther)).toBe("other");
    expect(Number.isInteger(russianOther)).toBe(false);
  });

  it("renders draft CLDR forms as they are typed without calling preview or save APIs", async () => {
    await renderEditor();
    const one = await screen.findByLabelText("One");
    const other = screen.getByLabelText("Other");
    const preview = screen.getByTestId("terminology-live-preview");

    expect(preview).toHaveTextContent("Request");
    expect(preview).toHaveTextContent(
      "Draft preview. Save to apply these terms.",
    );
    expect(
      screen.getByTestId("terminology-live-preview-one"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("terminology-live-preview-other"),
    ).toHaveTextContent("2");

    fireEvent.change(one, { target: { value: "Case" } });
    fireEvent.change(other, { target: { value: "Cases" } });

    expect(
      screen.getByTestId("terminology-live-preview-one"),
    ).toHaveTextContent("Case");
    expect(
      screen.getByTestId("terminology-live-preview-other"),
    ).toHaveTextContent("Cases");
    expect(preview).toHaveTextContent("Cases");
    expect(screen.getByRole("button", { name: "Create Case" })).toBeDisabled();
    expect(terminologyMocks.preview).not.toHaveBeenCalled();
    expect(terminologyMocks.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Preview forms" }));
    expect(preview).toHaveFocus();
    expect(terminologyMocks.preview).not.toHaveBeenCalled();
  });

  it("clears an empty draft when switching between empty terms and audiences", async () => {
    await renderEditor();
    fireEvent.change(await screen.findByLabelText("One"), {
      target: { value: "Unsaved Case" },
    });
    fireEvent.change(screen.getByLabelText("Other"), {
      target: { value: "Unsaved Cases" },
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Term" }));
    const projectOption = await screen.findByRole("option", {
      name: "project",
    });
    fireEvent.pointerDown(projectOption, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(projectOption, { button: 0, pointerType: "mouse" });
    fireEvent.click(projectOption);
    await waitFor(() => expect(screen.getByLabelText("One")).toHaveValue(""));

    fireEvent.click(screen.getByRole("combobox", { name: "Audience" }));
    fireEvent.click(await screen.findByRole("option", { name: "Staff" }));
    await waitFor(() => expect(screen.getByLabelText("Other")).toHaveValue(""));
    expect(terminologyMocks.save).not.toHaveBeenCalled();
    expect(terminologyMocks.preview).not.toHaveBeenCalled();
  });

  it("keeps the identical one/other warning and explicit save action", async () => {
    await renderEditor();
    fireEvent.change(await screen.findByLabelText("One"), {
      target: { value: "Case" },
    });
    fireEvent.change(screen.getByLabelText("Other"), {
      target: { value: "Case" },
    });

    expect(
      screen.getByText("The one and other forms are identical."),
    ).toBeVisible();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    expect(terminologyMocks.save).not.toHaveBeenCalled();
    await waitFor(() => expect(terminologyMocks.get).toHaveBeenCalledTimes(1));
  });
});

it("keeps History on the selected catalogue cell across term, audience and locale switches", async () => {
  await renderEditor();
  await screen.findByLabelText("One");
  expect(screen.getByTestId("term-history")).toHaveAttribute(
    "data-id",
    "request:both:en-US",
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Term" }));
  const project = await screen.findByRole("option", { name: "project" });
  fireEvent.pointerDown(project, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(project, { button: 0, pointerType: "mouse" });
  fireEvent.click(project);
  fireEvent.click(screen.getByRole("combobox", { name: "Audience" }));
  const staff = await screen.findByRole("option", { name: "Staff" });
  fireEvent.pointerDown(staff, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(staff, { button: 0, pointerType: "mouse" });
  fireEvent.click(staff);
  fireEvent.click(screen.getByRole("combobox", { name: "Locale" }));
  const german = await screen.findByRole("option", { name: /\(de-DE\)/ });
  fireEvent.pointerDown(german, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(german, { button: 0, pointerType: "mouse" });
  fireEvent.click(german);
  await waitFor(() =>
    expect(screen.getByTestId("term-history")).toHaveAttribute(
      "data-id",
      "project:agent:de-DE",
    ),
  );
  expect(screen.getByTestId("term-history")).toHaveAttribute(
    "data-workspace",
    "workspace-a",
  );
});

/** The History targets the global MutationCache would withdraw for the last save. */
const savedTargets = (queryClient: QueryClient) => {
  const mutation = queryClient.getMutationCache().getAll().at(-1);
  return mutation?.options.meta?.audits?.targets(
    mutation.state.variables as never,
    undefined as never,
  );
};
const cell = (id: string) => [
  {
    kind: "entity",
    type: "terminology_override",
    id,
    scope: { kind: "workspace", workspaceId: "workspace-a" },
  },
];

it("declares only the captured cell for a save even if selection changes", async () => {
  let finish!: (value: { overrides: unknown[]; etag: string }) => void;
  terminologyMocks.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { queryClient } = await renderEditor();
  fireEvent.change(await screen.findByLabelText("One"), {
    target: { value: "Case" },
  });
  fireEvent.change(screen.getByLabelText("Other"), {
    target: { value: "Cases" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(terminologyMocks.save).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("combobox", { name: "Term" }));
  fireEvent.click(await screen.findByRole("option", { name: "project" }));
  finish({ overrides: [], etag: '"v2"' });
  await waitFor(() =>
    expect(queryClient.getMutationCache().getAll().at(-1)?.state.status).toBe(
      "success",
    ),
  );
  expect(savedTargets(queryClient)).toEqual(cell("request:both:en-US"));
});

it("retains History after reset and keeps the screen usable after a failed save", async () => {
  terminologyMocks.save.mockResolvedValueOnce({ overrides: [], etag: '"v2"' });
  const { queryClient } = await renderEditor([
    {
      audience: "both",
      termKey: "request",
      locale: "en-US",
      forms: { one: "Case", other: "Cases" },
    },
  ]);
  await screen.findByDisplayValue("Case");
  fireEvent.click(screen.getByRole("button", { name: "Use default" }));
  await waitFor(() =>
    expect(queryClient.getMutationCache().getAll().at(-1)?.state.status).toBe(
      "success",
    ),
  );
  expect(savedTargets(queryClient)).toEqual(cell("request:both:en-US"));
  expect(screen.getByTestId("term-history")).toHaveAttribute(
    "data-id",
    "request:both:en-US",
  );
  terminologyMocks.save.mockRejectedValueOnce(new Error("refused"));
  fireEvent.change(screen.getByLabelText("One"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Other"), {
    target: { value: "News" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
});

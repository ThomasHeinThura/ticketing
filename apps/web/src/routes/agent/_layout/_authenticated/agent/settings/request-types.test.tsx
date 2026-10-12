import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./request-types";

const mocks = vi.hoisted(() => ({
  search: { requestTypeId: "rt-1" } as { requestTypeId?: string },
  navigate: vi.fn(),
  getRequestTypes: vi.fn(),
  getRequestType: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    fullPath: "/agent/settings/request-types",
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/fetchers/intake", () => ({
  deleteRequestType: vi.fn(),
  getRequestType: mocks.getRequestType,
  getRequestTypes: mocks.getRequestTypes,
  publishRequestType: vi.fn(),
  saveRequestType: vi.fn(),
  unpublishRequestType: vi.fn(),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => ({ data: [{ id: "wit-1", name: "Task" }], isLoading: false }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" }, isLoading: false }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const RequestTypesPage = (Route as unknown as { component: ComponentType })
  .component;

const type = {
  id: "rt-1",
  key: "access",
  name: "Access",
  description: "",
  group: "General",
  workItemTypeId: "wit-1",
  defaultProjectId: null,
  formSchema: {
    fields: [
      {
        key: "title",
        label: "Summary",
        type: "text",
        required: true,
        mapsTo: { field: "title" },
      },
      { key: "urgency", label: "Urgency", type: "select", required: false },
      { key: "evidence", label: "Evidence", type: "file", required: false },
    ],
  },
  published: false,
  version: 1,
  autoAccept: false,
  customerVisible: false,
  forcePrivate: false,
  position: 0,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RequestTypesPage />
    </QueryClientProvider>,
  );
}

describe("request type editor", () => {
  beforeEach(() => {
    mocks.search = { requestTypeId: "rt-1" };
    mocks.getRequestTypes.mockReset().mockResolvedValue({
      requestTypes: [type],
    });
    mocks.getRequestType.mockReset().mockResolvedValue(type);
  });
  afterEach(() => cleanup());

  it("keeps the same field row mounted while its key is edited", async () => {
    renderPage();
    const keyInput = (await screen.findAllByLabelText("Field key"))[1];
    expect(keyInput).toBeDefined();
    for (const value of ["u", "ur", "urg"]) {
      fireEvent.change(keyInput as HTMLElement, { target: { value } });
      const current = screen.getAllByLabelText("Field key")[1];
      // A re-keyed row would replace the node (losing focus and the typed value).
      expect(current).toBe(keyInput);
      expect(current).toHaveValue(value);
    }
  });

  it("keeps typed line breaks in the options textarea and tidies them on blur", async () => {
    renderPage();
    const options = (
      await screen.findAllByLabelText("Options (one per line)")
    )[1] as HTMLTextAreaElement;
    fireEvent.change(options, { target: { value: "low\n" } });
    expect(options).toHaveValue("low\n");
    fireEvent.change(options, { target: { value: "low\n\nhigh\n" } });
    expect(options).toHaveValue("low\n\nhigh\n");
    fireEvent.blur(options);
    expect(options).toHaveValue("low\nhigh");
  });

  it("names every control in the customer preview", async () => {
    renderPage();
    await screen.findAllByLabelText("Field key");
    const preview = screen.getByText("Customer preview").closest("section");
    expect(preview).not.toBeNull();
    for (const el of Array.from(
      (preview as HTMLElement).querySelectorAll("input:not([aria-hidden])"),
    )) {
      expect(
        el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby"),
      ).toBeTruthy();
    }
    expect(
      (preview as HTMLElement).querySelector('input[type="file"]'),
    ).toHaveAttribute("aria-label", "Evidence");
  });

  it("offers Retry on a load error and recovers", async () => {
    mocks.getRequestTypes
      .mockReset()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({ requestTypes: [type] });
    renderPage();
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getRequestTypes).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByLabelText("Field key")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

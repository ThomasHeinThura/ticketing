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
import type { ModuleRow } from "@/fetchers/agile";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  createModule: (...args: unknown[]) => mocks.create(...args),
  updateModule: (...args: unknown[]) => mocks.update(...args),
}));

import { ModuleFormDialog } from "./module-form-dialog";

function renderDialog(module?: ModuleRow) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ModuleFormDialog
        projectKey="HELP"
        module={module}
        leadCandidates={[]}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

async function chooseDate(date: string) {
  fireEvent.click(screen.getByRole("button", { name: "modules.form.target" }));
  const popup = screen.getByRole("dialog", { name: "modules.form.target" });
  await waitFor(() => expect(popup).toBeVisible());
  const entry = within(popup).getByPlaceholderText("YYYY-MM-DD");
  fireEvent.change(entry, { target: { value: date } });
  fireEvent.keyDown(entry, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "modules.form.target" }),
    ).toBeNull(),
  );
}

const existing: ModuleRow = {
  id: "module-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  name: "Delivery",
  description: null,
  lead: null,
  state: "planned",
  targetDate: "2026-10-30",
  version: 7,
  progress: { total: 0, completed: 0, cancelled: 0, remaining: 0, percent: 0 },
  forecast: { status: "no_target" },
};

afterEach(cleanup);
beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({});
  mocks.update.mockReset().mockResolvedValue({});
});

describe("ModuleFormDialog dates", () => {
  it("keeps target optional and sends null when no date is selected", async () => {
    const { container } = renderDialog();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("modules.form.name"), {
      target: { value: "Delivery" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "modules.form.create" }),
    );
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith("HELP", {
        name: "Delivery",
        description: null,
        leadId: null,
        state: "planned",
        targetDate: null,
      }),
    );
  });

  it("sends the exact selected calendar day and original version when editing", async () => {
    renderDialog(existing);
    await chooseDate("2024-02-29");
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith("module-1", {
        name: "Delivery",
        description: null,
        leadId: null,
        state: "planned",
        targetDate: "2024-02-29",
        version: 7,
      }),
    );
  });

  it("clears an existing target locally and persists null only on outer save", async () => {
    renderDialog(existing);
    fireEvent.click(
      screen.getByRole("button", { name: "modules.form.target" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "modules.form.target" }),
      ).getByRole("button", { name: "customFields:value.clear" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "modules.form.target" }),
      ).toBeNull(),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "module-1",
        expect.objectContaining({ targetDate: null, version: 7 }),
      ),
    );
  });

  it("rejects invalid leap-day entry without changing the saved target", async () => {
    renderDialog(existing);
    fireEvent.click(
      screen.getByRole("button", { name: "modules.form.target" }),
    );
    const popup = screen.getByRole("dialog", { name: "modules.form.target" });
    await waitFor(() => expect(popup).toBeVisible());
    const entry = within(popup).getByPlaceholderText("YYYY-MM-DD");
    fireEvent.change(entry, { target: { value: "2025-02-29" } });
    expect(
      within(popup).getByRole("button", { name: "common.save" }),
    ).toBeDisabled();
    fireEvent.keyDown(entry, { key: "Enter", code: "Enter" });
    expect(
      screen.getByRole("dialog", { name: "modules.form.target" }),
    ).toBeVisible();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

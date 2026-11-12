import de from "@i18n/de-DE.json";
import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRoleDetail } from "@/fetchers/workspace-roles";
import { RoleComparePanel, RoleSummaryPanel } from "./role-insight-panels";

const role: WorkspaceRoleDetail = {
  id: "role-1",
  workspaceId: "ws",
  role: "support",
  name: "Support",
  description: null,
  rank: 20,
  capabilities: [],
  isSystem: false,
  isEditable: true,
  holderCount: 0,
  version: "1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

describe("role insight translations", () => {
  it("renders localized group, description and comparison labels", async () => {
    const resources = structuredClone(de);
    resources.roles.capabilityCatalog.labels.work_item__read =
      "Lesen lokalisiert";
    resources.roles.capabilityCatalog.descriptions.work_item__read =
      "Beschreibung lokalisiert";
    resources.godModeOrganisations.quotaMaxWorkItems = "Gruppe lokalisiert";
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      lng: "de-DE",
      resources: { "de-DE": resources },
      interpolation: { escapeValue: false },
    });
    render(
      <I18nextProvider i18n={instance}>
        <RoleSummaryPanel capabilities={["work_item:read"]} />
        <RoleComparePanel
          role={role}
          roles={[role, { ...role, id: "role-2", name: "Other" }]}
          capabilities={["work_item:read"]}
          otherId="role-2"
          onOtherChange={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("Gruppe lokalisiert")).toBeInTheDocument();
    expect(screen.getAllByText("Beschreibung lokalisiert")).toHaveLength(2);
    expect(screen.getByText("Lesen lokalisiert")).toBeInTheDocument();
  });
});

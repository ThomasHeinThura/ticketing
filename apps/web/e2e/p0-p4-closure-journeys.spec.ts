import { expect, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

test.describe("Stage P0–P4 Full Closure E2E Journeys", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installPerformanceApiFixture(page);
    await page.route("**/api/projects/*/states", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "state-g11",
            stateTemplateId: "tpl-backlog",
            name: "Backlog",
            group: "backlog",
            position: 0,
            isDefault: true,
          },
          {
            id: "state-in-progress",
            stateTemplateId: "tpl-in-progress",
            name: "In progress",
            group: "started",
            position: 1,
            isDefault: false,
          },
        ]),
      }),
    );
    await page.route("**/api/capabilities**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          manageProjects: true,
          createProjects: true,
          updateProjects: true,
          deleteProjects: true,
          updateTasks: true,
          createTasks: true,
          deleteTasks: true,
          assignTasks: true,
          exportTasks: true,
          createLabels: true,
          updateLabels: true,
          deleteLabels: true,
          manageWorkspace: true,
          deleteWorkspace: true,
          inviteUsers: true,
          manageTeam: true,
          removeMembers: true,
          manageServiceCalendars: true,
          shareSavedViews: true,
          manageWorkspaceSettings: true,
        }),
      }),
    );
  });

  test("Journey 1 (P0 & P2): Agent Sign-in provider chooser, My Work Approvals lens, Milestones Plan, Stakeholders, Work Item Types, Workflows, SLA Settings, and Audit Log", async ({
    page,
  }) => {
    await page.goto("/agent/sign-in");
    await expect(
      page.getByRole("heading", { name: "Sign in to TaskDesk Agent" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("agent-signin-provider-chooser"),
    ).toBeVisible();

    await page.goto("/agent/my-work?lens=approvals");
    await expect(
      page.getByRole("heading", { name: "Approvals inbox" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Approvals inbox" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/plan");
    await expect(
      page.getByRole("heading", { name: "Milestones & prerequisites" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/stakeholders");
    await expect(
      page.getByRole("heading", { name: "Project stakeholders" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/settings/sla");
    await expect(
      page.getByRole("heading", { name: "Project — SLA & calendar" }),
    ).toBeVisible();

    await page.goto("/agent/settings/work-item-types");
    await expect(
      page.getByRole("heading", { name: "Workspace — work item types" }),
    ).toBeVisible();

    await page.goto("/agent/settings/workflows");
    await expect(
      page.getByRole("heading", { name: "Workspace — workflows" }),
    ).toBeVisible();

    await page.goto("/agent/settings/workflows/wf-standard");
    await expect(
      page.getByRole("heading", { name: "Workflow editor" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/audit");
    await expect(
      page.getByRole("heading", { name: "Audit log" }),
    ).toBeVisible();
  });

  test("Journey 2 (P3 Identity & Organisations): Agent Invite, Profile Security, and God Mode Organisations & Identity", async ({
    page,
  }) => {
    await page.goto("/agent/invite");
    await expect(
      page.getByRole("heading", { name: "Accept Workspace Invitation" }),
    ).toBeVisible();

    await page.goto("/agent/settings/profile/security");
    await expect(
      page.getByRole("heading", { name: "Profile Security & Sessions" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/organisations");
    await expect(
      page.getByRole("heading", { name: "Customer Organisations" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/organisations/org-acme");
    await expect(
      page.getByRole("heading", { name: "Acme Corp (org-acme)" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/organisations/org-acme/identity");
    await expect(
      page.getByRole("heading", {
        name: "Organisation Identity & SCIM (org-acme)",
      }),
    ).toBeVisible();
  });

  test("Journey 3 (P4 Governance): Profile Notifications & API Keys, Terminology, Teams, Roles, Custom Fields + Section Manager, Automations, Webhooks, and Project Features/Automations", async ({
    page,
  }) => {
    await page.goto("/agent/settings/profile/notifications");
    await expect(
      page.getByRole("heading", { name: "Notification Preferences" }),
    ).toBeVisible();

    await page.goto("/agent/settings/profile/api-keys");
    await expect(
      page.getByRole("heading", { name: "Personal API Keys" }),
    ).toBeVisible();

    await page.goto("/agent/settings/terminology");
    await expect(
      page.getByRole("heading", { name: "Workspace Terminology" }),
    ).toBeVisible();

    await page.goto("/agent/settings/teams");
    await expect(
      page.getByRole("heading", { name: "Workspace Teams" }),
    ).toBeVisible();

    await page.goto("/agent/settings/teams/team-tier1");
    await expect(
      page.getByRole("heading", { name: "Team Detail: team-tier1" }),
    ).toBeVisible();

    await page.goto("/agent/settings/roles");
    await expect(
      page.getByRole("heading", { name: "Workspace Roles" }),
    ).toBeVisible();

    await page.goto("/agent/settings/roles/role-agent");
    await expect(
      page.getByRole("heading", { name: "Role Capability Matrix: role-agent" }),
    ).toBeVisible();

    await page.goto("/agent/settings/custom-fields");
    await expect(
      page.getByRole("heading", { name: "Workspace Custom Fields" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("custom-fields-section-manager"),
    ).toBeVisible();

    await page.goto("/agent/settings/custom-fields/cf-impact");
    await expect(
      page.getByRole("heading", {
        name: "Custom Field Definition: cf-impact",
      }),
    ).toBeVisible();

    await page.goto("/agent/settings/automations");
    await expect(
      page.getByRole("heading", { name: "Workspace Automations" }),
    ).toBeVisible();

    await page.goto("/agent/settings/webhooks");
    await expect(
      page.getByRole("heading", { name: "Outbound Webhooks" }),
    ).toBeVisible();

    await page.goto("/agent/settings/webhooks/wh-1");
    await expect(
      page.getByRole("heading", { name: "Webhook Endpoint: wh-1" }),
    ).toBeVisible();

    await page.goto("/agent/settings/webhooks/wh-1/deliveries");
    await expect(
      page.getByRole("heading", { name: "Webhook Delivery Attempts: wh-1" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/settings/features");
    await expect(
      page.getByRole("heading", { name: "Project Feature Modules (WLP)" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/settings/automations");
    await expect(
      page.getByRole("heading", { name: "Project Automations (WLP)" }),
    ).toBeVisible();
  });

  test("Journey 4 (P4 God Mode): Home/Health, General, Branding, Storage, Notifications, Deliveries, Features, Jobs, Plugins, and MCP", async ({
    page,
  }) => {
    await page.goto("/agent/god-mode");
    await expect(
      page.getByRole("heading", { name: "God Mode home / health" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/general");
    await expect(
      page.getByRole("heading", { name: "General instance configuration" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/branding");
    await expect(
      page.getByRole("heading", { name: "Instance branding configuration" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/storage");
    await expect(
      page.getByRole("heading", {
        name: "Attachment storage backend settings",
      }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/notifications");
    await expect(
      page.getByRole("heading", { name: "Instance notification channels" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/deliveries");
    await expect(
      page.getByRole("heading", {
        name: "Instance outbox & dead-letter queue inspector",
      }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/features");
    await expect(
      page.getByRole("heading", { name: "Instance-wide feature flags" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/jobs");
    await expect(
      page.getByRole("heading", {
        name: "Background jobs & scheduled workers monitor",
      }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/plugins");
    await expect(
      page.getByRole("heading", { name: "Registered plugin contracts" }),
    ).toBeVisible();

    await page.goto("/agent/god-mode/mcp");
    await expect(
      page.getByRole("heading", {
        name: "Model Context Protocol (MCP) usage & governance",
      }),
    ).toBeVisible();
  });
});

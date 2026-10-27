import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const origin = "https://ticketing.localhost";
const stateRoot = path.join(
  os.homedir(),
  "Library/Application Support/TaskDesk/codex-sit-20261025",
);
const evidenceRoot = path.resolve(
  process.cwd(),
  "../../docs/report/browser/organisation-lifecycle-183",
);
const organisationKey = "qo5fteg";
const projectKey = "QALIFE";
const timestamp = new Date().toISOString().replace(/[-:.]/gu, "").slice(0, 15);

test.use({
  baseURL: origin,
  colorScheme: "light",
  ignoreHTTPSErrors: false,
  locale: "en-US",
  reducedMotion: "reduce",
  storageState: path.join(stateRoot, "admin-state.json"),
  timezoneId: "Asia/Yangon",
  viewport: { width: 1440, height: 1000 },
});

type OrganisationDirectory = {
  data: Array<{
    id: string;
    name: string;
    key: string;
    active: boolean;
    portalAccess: boolean;
    profileEtag: string;
    deletedAt: string | null;
    purgeAfter: string | null;
    deletionGeneration: number;
    deletionOperationId: string | null;
    catalogue: { etag: string; requestTypeIds: string[] };
  }>;
};

type ProjectList = Array<{
  id: string;
  slug: string;
  organisationId: string | null;
  archivedAt?: string | null;
}>;

function outsideDirectorySignature(
  directory: OrganisationDirectory,
  ownId: string,
) {
  const rows = directory.data
    .filter((row) => row.id !== ownId)
    .map((row) => ({
      id: row.id,
      profileEtag: row.profileEtag,
      catalogueEtag: row.catalogue.etag,
      requestTypeIds: [...row.catalogue.requestTypeIds].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    count: rows.length,
    digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

async function directory(page: Page): Promise<OrganisationDirectory> {
  return page.evaluate(async () => {
    const response = await fetch("/api/instance/organisations", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Organisation directory returned ${response.status}`);
    return (await response.json()) as OrganisationDirectory;
  });
}

async function projects(page: Page, workspaceId: string): Promise<ProjectList> {
  return page.evaluate(async (id) => {
    const response = await fetch(
      `/api/project?workspaceId=${encodeURIComponent(id)}&includeArchived=true`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok)
      throw new Error(`Project list returned ${response.status}`);
    return (await response.json()) as ProjectList;
  }, workspaceId);
}

async function activeWorkspaceId(page: Page) {
  const value = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Session read returned ${response.status}`);
    const body = (await response.json()) as {
      session?: { activeOrganizationId?: string | null };
    };
    return body.session?.activeOrganizationId ?? null;
  });
  if (!value) throw new Error("Admin session has no active workspace");
  return value;
}

async function secretRotationHealth(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/instance/health", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Instance health returned ${response.status}`);
    const body = (await response.json()) as {
      checks?: Array<{
        key: string;
        state: string;
        detail: Record<string, unknown>;
      }>;
    };
    const row = body.checks?.find(
      (check) => check.key === "secrets_encryption",
    );
    if (!row) throw new Error("Secrets encryption health check is missing");
    return {
      state: row.state,
      secretsTotal: row.detail.secretsTotal ?? null,
      secretsPendingRekey: row.detail.secretsPendingRekey ?? null,
      rekeyComplete: row.detail.rekeyComplete ?? null,
      safeToRemovePreviousKey: row.detail.safeToRemovePreviousKey ?? null,
      keyConfigured: row.detail.keyConfigured ?? null,
    };
  });
}

async function privateAdminPassword() {
  const raw = await readFile(path.join(stateRoot, "credentials.json"), "utf8");
  const credentials = JSON.parse(raw) as {
    accounts: Array<{ role: string; password: string }>;
  };
  const password = credentials.accounts.find(
    (account) => account.role === "admin",
  )?.password;
  if (!password) throw new Error("Admin step-up credential is unavailable");
  return password;
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((selectedTheme) => {
    const key = "user-preferences";
    const raw = window.localStorage.getItem(key);
    const stored = raw
      ? (JSON.parse(raw) as { state?: Record<string, unknown> })
      : { state: {} };
    if (!stored.state || typeof stored.state !== "object")
      throw new Error("User preference storage is malformed");
    stored.state.theme = selectedTheme;
    window.localStorage.setItem(key, JSON.stringify(stored));
  }, theme);
}

async function captureState(
  page: Page,
  url: string,
  width: number,
  theme: "light" | "dark",
  suffix: string,
  label: string,
  screenshots: string[],
) {
  await setTheme(page, theme);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 });
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible({
    timeout: 12_000,
  });
  const file = `${suffix}-${width}-${theme}-${timestamp}.png`;
  await page.screenshot({
    path: path.join(evidenceRoot, file),
    fullPage: true,
  });
  screenshots.push(file);
}

test("soft-delete and restore the existing QA organisation through God Mode", async ({
  page,
}) => {
  await mkdir(evidenceRoot, { recursive: true });
  const adminPassword = await privateAdminPassword();
  const summary: Record<string, unknown> = {
    run: "organisation-lifecycle-183",
    result: "in_progress",
    fixtureScope:
      "existing owned QA organisation and existing QALIFE project only",
    deleteRequestStatus: null,
    restoreStatus: null,
    screenshots: [] as string[],
  };
  let profileUrl: string | null = null;
  let organisationId: string | null = null;
  let organisationName: string | null = null;
  let restoreNeeded = false;
  let restoreSucceeded = false;

  try {
    await page.goto("/agent/god-mode/organisations", {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    });
    await expect(
      page.getByRole("heading", { name: "Organisations", exact: true }),
    ).toBeVisible();
    const beforeDirectory = await directory(page);
    const fixture = beforeDirectory.data.find(
      (row) => row.key === organisationKey,
    );
    if (
      !fixture ||
      fixture.deletedAt !== null ||
      !fixture.active ||
      !fixture.portalAccess
    )
      throw new Error(
        "The owned QA organisation is not in its expected active state",
      );
    organisationId = fixture.id;
    organisationName = fixture.name;
    profileUrl = `/agent/god-mode/organisations?organisationId=${encodeURIComponent(fixture.id)}`;
    const outsideBefore = outsideDirectorySignature(
      beforeDirectory,
      fixture.id,
    );
    summary.outsideDirectoryBaseline = outsideBefore;
    const workspaceId = await activeWorkspaceId(page);
    const beforeProjects = await projects(page, workspaceId);
    const project = beforeProjects.find((row) => row.slug === projectKey);
    if (!project || project.organisationId !== fixture.id)
      throw new Error(
        "The existing QALIFE project is not owned by the QA organisation",
      );
    const priorProjectArchived = project.archivedAt != null;

    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    });
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      fixture.name,
    );
    const deleteButton = page.getByRole("button", {
      name: "Delete organisation",
      exact: true,
    });
    await expect(deleteButton).toBeVisible();
    await expect(deleteButton).toBeEnabled();
    const deleteRequest = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname ===
          `/api/instance/organisations/${encodeURIComponent(fixture.id)}`,
      { timeout: 15_000 },
    );
    await deleteButton.click();
    const deleteResponse = await deleteRequest;
    summary.deleteRequestStatus = deleteResponse.status();
    expect(deleteResponse.status()).toBe(202);
    const requestBody = (await deleteResponse.json()) as {
      pendingActionId?: string;
    };
    const pendingActionId = requestBody.pendingActionId;
    if (!pendingActionId)
      throw new Error("Delete request did not return its pending action");

    const typedName = page.locator("#confirm-target-name");
    const stepUpSecret = page.locator("#pending-action-step-up-secret");
    await expect(typedName).toBeVisible({ timeout: 12_000 });
    await expect(stepUpSecret).toBeVisible({ timeout: 12_000 });
    const pendingAction = await page.evaluate(async (id) => {
      const [detailResponse, listResponse] = await Promise.all([
        fetch(`/api/me/pending-actions/${encodeURIComponent(id)}`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch("/api/me/pending-actions?limit=50", {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      if (!detailResponse.ok || !listResponse.ok)
        throw new Error(
          `Pending-action read failed: ${detailResponse.status()}/${listResponse.status()}`,
        );
      const detail = await detailResponse.json();
      const list = (await listResponse.json()) as {
        data?: Array<{ id: string }>;
      };
      return {
        detail,
        listedAsCurrentRequester:
          list.data?.some((row) => row.id === id) === true,
      };
    }, pendingActionId);
    expect(pendingAction.detail).toMatchObject({
      action: "delete",
      targetType: "organisation",
      confirmation: "typed_name_step_up",
      state: "pending",
      requestingKeyName: null,
    });
    expect(pendingAction.listedAsCurrentRequester).toBe(true);
    const pendingDialogLabels = await page
      .getByRole("dialog")
      .locator("button")
      .allTextContents();
    summary.pendingDialogLabels = pendingDialogLabels
      .map((text) => text.trim())
      .filter(Boolean);
    summary.pendingAction = {
      sameSessionRequester: pendingAction.listedAsCurrentRequester,
      sessionCredential: pendingAction.detail.requestingKeyName === null,
      targetAndConfirmation: "organisation / typed_name_step_up",
    };
    await typedName.fill(fixture.name);
    await stepUpSecret.fill(adminPassword);
    const approveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/me/pending-actions/${encodeURIComponent(pendingActionId)}/approve`,
      { timeout: 15_000 },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    const approved = await approveResponse;
    summary.approvalStatus = approved.status();
    expect(approved.status()).toBe(200);
    const approvalBody = (await approved.json()) as { state?: string };
    expect(approvalBody.state).toBe("executed");
    restoreNeeded = true;

    await expect
      .poll(
        async () =>
          (await directory(page)).data.find((row) => row.id === fixture.id)
            ?.deletedAt ?? null,
        {
          timeout: 15_000,
          message: "deleted organisation appears in the admin directory",
        },
      )
      .not.toBeNull();
    const deletedDirectory = await directory(page);
    const deleted = deletedDirectory.data.find((row) => row.id === fixture.id);
    expect(deleted).toMatchObject({ active: false, portalAccess: false });
    expect(deleted?.deletionOperationId).toBeTruthy();
    expect(outsideDirectorySignature(deletedDirectory, fixture.id)).toEqual(
      outsideBefore,
    );
    const deletedProjects = await projects(page, workspaceId);
    const deletedProject = deletedProjects.find((row) => row.id === project.id);
    expect(deletedProject?.archivedAt).not.toBeNull();
    summary.deletedState = {
      directoryEntryVisible: true,
      active: deleted?.active,
      portalAccess: deleted?.portalAccess,
      projectArchived: deletedProject?.archivedAt != null,
      priorProjectWasArchived: priorProjectArchived,
      outsideDirectoryUnchanged: true,
    };

    const screenshots = summary.screenshots as string[];
    for (const width of [375, 768, 1440]) {
      for (const theme of ["light", "dark"] as const) {
        await captureState(
          page,
          profileUrl,
          width,
          theme,
          "deleted",
          fixture.name,
          screenshots,
        );
        await expect(
          page.locator("#organisation-restore-secret"),
        ).toBeVisible();
      }
    }

    await setTheme(page, "light");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    });
    await expect(page.locator("#organisation-restore-secret")).toBeVisible({
      timeout: 12_000,
    });
    const restoreLabels = await page.locator("button").allTextContents();
    summary.restorePageLabels = restoreLabels
      .map((text) => text.trim())
      .filter(Boolean);
    await page.locator("#organisation-restore-secret").fill(adminPassword);
    const restoreResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/instance/organisations/${encodeURIComponent(fixture.id)}/restore`,
      { timeout: 15_000 },
    );
    await page
      .getByRole("button", { name: "Restore organisation", exact: true })
      .click();
    const restored = await restoreResponse;
    summary.restoreStatus = restored.status();
    expect(restored.status()).toBe(200);
    restoreSucceeded = true;
    restoreNeeded = false;
    await expect
      .poll(
        async () => {
          const row = (await directory(page)).data.find(
            (entry) => entry.id === fixture.id,
          );
          return row
            ? {
                deletedAt: row.deletedAt,
                active: row.active,
                portalAccess: row.portalAccess,
              }
            : null;
        },
        {
          timeout: 15_000,
          message: "restored organisation reappears in the directory",
        },
      )
      .toEqual({ deletedAt: null, active: true, portalAccess: true });
    const restoredProjects = await projects(page, workspaceId);
    const restoredProject = restoredProjects.find(
      (row) => row.id === project.id,
    );
    expect(restoredProject).toBeDefined();
    expect(restoredProject?.archivedAt != null).toBe(priorProjectArchived);
    const afterDirectory = await directory(page);
    expect(outsideDirectorySignature(afterDirectory, fixture.id)).toEqual(
      outsideBefore,
    );
    summary.restoredState = {
      active: true,
      portalAccess: true,
      projectArchiveMatchesPriorState:
        (restoredProject?.archivedAt != null) === priorProjectArchived,
      outsideDirectoryUnchanged: true,
    };

    for (const width of [375, 768, 1440]) {
      for (const theme of ["light", "dark"] as const) {
        await captureState(
          page,
          profileUrl,
          width,
          theme,
          "restored",
          fixture.name,
          screenshots,
        );
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          fixture.name,
        );
      }
    }

    const healthBeforePanel = await secretRotationHealth(page);
    const pluginScreenshots: string[] = [];
    const dialogLabels = new Set<string>();
    for (const width of [375, 768, 1440]) {
      for (const theme of ["light", "dark"] as const) {
        await setTheme(page, theme);
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/agent/god-mode/plugins", {
          waitUntil: "domcontentloaded",
          timeout: 12_000,
        });
        await expect(
          page.getByRole("heading", { name: "Plugins", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Encryption key rotation", { exact: true }),
        ).toBeVisible();
        if (typeof healthBeforePanel.secretsTotal === "number")
          await expect(
            page.getByText(
              `Secrets stored: ${healthBeforePanel.secretsTotal}`,
              { exact: true },
            ),
          ).toBeVisible();
        if (typeof healthBeforePanel.secretsPendingRekey === "number")
          await expect(
            page.getByText(
              `Secrets awaiting rekey: ${healthBeforePanel.secretsPendingRekey}`,
              { exact: true },
            ),
          ).toBeVisible();

        const visibleButtons = (await page.locator("button").allTextContents())
          .map((text) => text.trim())
          .filter(Boolean);
        const rotateLabel = visibleButtons.find(
          (label) => label === "Rotate secrets",
        );
        if (!rotateLabel)
          throw new Error("Rendered rotation action label is missing");
        await page
          .getByRole("button", { name: rotateLabel, exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible({ timeout: 12_000 });
        await expect(
          dialog.getByRole("heading", { name: "Rotate secrets", exact: true }),
        ).toBeVisible();
        await expect(dialog.locator("#rotate-secrets-secret")).toBeVisible();
        const currentDialogLabels = (
          await dialog.locator("button").allTextContents()
        )
          .map((text) => text.trim())
          .filter(Boolean);
        for (const label of currentDialogLabels) dialogLabels.add(label);
        const dialogScreenshot = `plugins-rotation-dialog-${width}-${theme}-${timestamp}.png`;
        await page.screenshot({
          path: path.join(evidenceRoot, dialogScreenshot),
          fullPage: true,
        });
        pluginScreenshots.push(dialogScreenshot);
        const cancelLabel = currentDialogLabels.find(
          (label) => label === "Cancel",
        );
        if (!cancelLabel)
          throw new Error("Rendered rotation cancel action is missing");
        await dialog
          .getByRole("button", { name: cancelLabel, exact: true })
          .click();
        await expect(dialog).toHaveCount(0, { timeout: 12_000 });
        const panelScreenshot = `plugins-rotation-panel-${width}-${theme}-${timestamp}.png`;
        await page.screenshot({
          path: path.join(evidenceRoot, panelScreenshot),
          fullPage: true,
        });
        pluginScreenshots.push(panelScreenshot);
      }
    }
    const healthAfterPanel = await secretRotationHealth(page);
    expect(healthAfterPanel).toEqual(healthBeforePanel);
    summary.pluginsRotationPanel = {
      widths: [375, 768, 1440],
      themes: ["light", "dark"],
      dialogLabels: [...dialogLabels],
      liveHealth: healthBeforePanel,
      healthUnchangedAfterOpenClose: true,
      noRotationStarted: true,
      screenshots: pluginScreenshots,
    };
    summary.outsideDirectoryAfterRestore = outsideDirectorySignature(
      await directory(page),
      organisationId as string,
    );
    (summary.screenshots as string[]).push(...pluginScreenshots);
  } finally {
    if (restoreNeeded && !restoreSucceeded && profileUrl && organisationId) {
      try {
        await page.goto(profileUrl, {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
        const restoreField = page.locator("#organisation-restore-secret");
        if (await restoreField.isVisible({ timeout: 3_000 })) {
          await restoreField.fill(adminPassword);
          const restoreResponse = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                `/api/instance/organisations/${encodeURIComponent(organisationId as string)}/restore`,
            { timeout: 12_000 },
          );
          await page
            .getByRole("button", { name: "Restore organisation", exact: true })
            .click();
          const response = await restoreResponse;
          if (response.ok()) restoreSucceeded = true;
        }
      } catch {
        summary.cleanupRestore =
          "failed; fixture needs immediate owner attention";
      }
    }
  }

  expect(restoreSucceeded).toBe(true);
  expect(organisationName).toBeTruthy();
  summary.result = "passed";
  await writeFile(
    path.join(
      evidenceRoot,
      `organisation-lifecycle-delete-restore-${timestamp}.json`,
    ),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
});

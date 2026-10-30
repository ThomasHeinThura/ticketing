import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const agentOrigin = "https://ticketing.localhost";
const stateRoot = path.join(
  os.homedir(),
  "Library/Application Support/TaskDesk/codex-sit-20261025",
);
const evidenceRoot = path.resolve(
  process.cwd(),
  "../../docs/report/browser/organisation-lifecycle-181",
);
const timestamp = new Date().toISOString().replace(/[-:.]/gu, "").slice(0, 15);
const organisationName = "Codex QA Organisation Lifecycle 20261025T181626";
const organisationKey = "qo5fteg";
const projectKey = "QALIFE";

test.use({
  baseURL: agentOrigin,
  colorScheme: "light",
  ignoreHTTPSErrors: false,
  locale: "en-US",
  reducedMotion: "reduce",
  storageState: path.join(stateRoot, "admin-state.json"),
  timezoneId: "Asia/Yangon",
  viewport: { width: 1440, height: 1000 },
});

type Directory = {
  data: Array<{
    id: string;
    name: string;
    key: string;
    profileEtag: string;
    catalogue: { etag: string; requestTypeIds: string[] };
  }>;
  options: Array<{
    id: string;
    workspaceId: string;
    name: string;
    autoAccept: boolean;
  }>;
  projectDefaultOptions: Array<{
    workspaceId: string;
    workspaceName: string;
    serviceCalendars: Array<{ id: string; name: string }>;
    slaPolicies: Array<{ id: string; name: string; published: boolean }>;
  }>;
};

function directorySignature(directory: Directory) {
  const rows = directory.data
    .map((organisation) => ({
      id: organisation.id,
      profileEtag: organisation.profileEtag,
      catalogueEtag: organisation.catalogue.etag,
      requestTypeIds: [...organisation.catalogue.requestTypeIds].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    count: rows.length,
    digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

async function readDirectory(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/instance/organisations", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Organisation directory returned ${response.status}`);
    return (await response.json()) as Directory;
  });
}

async function readSmtpGate(page: import("@playwright/test").Page) {
  const provider = await page.evaluate(async () => {
    const response = await fetch("/api/instance/notification-providers/email", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return { enabled: false, localMailpit: false };
    const value = (await response.json()) as {
      enabled?: boolean;
      config?: { host?: string; port?: number } | null;
    };
    const host = value.config?.host?.trim().toLowerCase();
    return {
      enabled: value.enabled === true,
      localMailpit: host === "mailpit" && value.config?.port === 1025,
    };
  });
  if (!provider.enabled || !provider.localMailpit)
    return { confirmed: false, messageCount: null as number | null };

  try {
    const response = await page.request.get(
      "https://mail.localhost/api/v1/messages",
      { timeout: 4_000 },
    );
    if (!response.ok()) return { confirmed: false, messageCount: null };
    const value = (await response.json()) as {
      total?: number;
      messages?: unknown[];
    };
    return {
      confirmed: true,
      messageCount:
        typeof value.total === "number"
          ? value.total
          : Array.isArray(value.messages)
            ? value.messages.length
            : null,
    };
  } catch {
    return { confirmed: false, messageCount: null };
  }
}

async function selectNamedOption(
  page: import("@playwright/test").Page,
  combo: import("@playwright/test").Locator,
  name: string,
) {
  await combo.click();
  const option = page.getByRole("option", { name, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  return name;
}

test("God Mode organisation lifecycle on persisted local SIT data", async ({
  browser,
  page,
}) => {
  await mkdir(evidenceRoot, { recursive: true });
  const summary: Record<string, unknown> = {
    run: "organisation-lifecycle-181",
    result: "in_progress",
    fixture: "one owned Codex QA organisation and one owned project",
    initialContact: "skipped",
    screenshots: [] as string[],
  };

  await page.goto("/god-mode/organisations", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Organisations", exact: true }),
  ).toBeVisible();
  const baseline = await readDirectory(page);
  const existingFixture = baseline.data.find(
    (organisation) => organisation.key === organisationKey,
  );
  const before = directorySignature({
    ...baseline,
    data: baseline.data.filter(
      (organisation) => organisation.id !== existingFixture?.id,
    ),
  });
  const smtpGate = await readSmtpGate(page);
  summary.localMailpitConfirmed = smtpGate.confirmed;
  if (!smtpGate.confirmed)
    summary.initialContactReason = "SMTP was not confirmed as local Mailpit";
  const existingAssignedTypeId = existingFixture?.catalogue.requestTypeIds[0];
  const typeIndex = baseline.options.findIndex(
    (option) =>
      !option.autoAccept &&
      (existingAssignedTypeId ? option.id === existingAssignedTypeId : true),
  );
  if (typeIndex < 0) throw new Error("No eligible generic request type exists");
  const selectedType = baseline.options[typeIndex];
  if (!selectedType) throw new Error("Selected request type metadata missing");

  const sessionShape = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const value = (await response.json()) as {
      session?: { activeOrganizationId?: string | null };
    };
    return value.session?.activeOrganizationId ?? null;
  });
  const activeDefaultsIndex = baseline.projectDefaultOptions.findIndex(
    (option) => option.workspaceId === sessionShape,
  );
  const activeDefaults =
    activeDefaultsIndex >= 0
      ? baseline.projectDefaultOptions[activeDefaultsIndex]
      : undefined;
  const defaultCalendar = activeDefaults?.serviceCalendars[0];
  const defaultSla = activeDefaults?.slaPolicies.find(
    (policy) => policy.published,
  );
  console.log(
    JSON.stringify({
      activeWorkspace: activeDefaults?.workspaceName ?? null,
      availableCalendarNames:
        activeDefaults?.serviceCalendars.map((calendar) => calendar.name) ?? [],
      publishedSlaNames:
        activeDefaults?.slaPolicies
          .filter((policy) => policy.published)
          .map((policy) => policy.name) ?? [],
    }),
  );

  await page.getByRole("button", { name: "New organisation" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  const requestCatalogue = page
    .getByRole("heading", { name: "Request catalogue", exact: true })
    .locator("xpath=../..");
  const selectedTypeCheckbox = requestCatalogue
    .getByRole("checkbox")
    .nth(typeIndex);
  await expect(selectedTypeCheckbox).toHaveAttribute("aria-checked", "false");
  const initialContactWorkspace = page.getByRole("combobox", {
    name: "Service workspace",
  });
  await expect(initialContactWorkspace).toBeDisabled();
  await expect(initialContactWorkspace).toContainText("Choose a workspace");
  await page.screenshot({
    path: path.join(evidenceRoot, `new-defaults-${timestamp}.png`),
    fullPage: true,
  });
  (summary.screenshots as string[]).push(`new-defaults-${timestamp}.png`);

  await page.getByLabel("Name", { exact: true }).fill(organisationName);
  await page.getByLabel("Key", { exact: true }).fill(organisationKey);
  await selectedTypeCheckbox.click();
  await expect(selectedTypeCheckbox).toHaveAttribute("aria-checked", "true");
  await expect(initialContactWorkspace).toBeEnabled();
  await expect(initialContactWorkspace).toContainText("Choose a workspace");

  if (activeDefaultsIndex >= 0) {
    const workspaceDefaults = page.locator("fieldset").nth(activeDefaultsIndex);
    if (defaultCalendar) {
      const calendarName = await selectNamedOption(
        page,
        workspaceDefaults.getByRole("combobox", {
          name: "Service calendar",
        }),
        defaultCalendar.name,
      );
      if (calendarName !== defaultCalendar.name)
        throw new Error(
          "Selected service calendar did not match workspace option",
        );
    }
    if (defaultSla) {
      const slaName = await selectNamedOption(
        page,
        workspaceDefaults.getByRole("combobox", { name: "SLA policy" }),
        defaultSla.name,
      );
      if (slaName !== defaultSla.name)
        throw new Error("Selected SLA policy did not match workspace option");
    }
  }

  if (smtpGate.confirmed) {
    const servedWorkspace = baseline.projectDefaultOptions.find(
      (workspace) => workspace.workspaceId === selectedType.workspaceId,
    );
    const invitationEmail = `codex.qa.${Date.now()}@example.test`;
    if (servedWorkspace) {
      await page.getByLabel("Email", { exact: true }).fill(invitationEmail);
      const serviceWorkspace = page.getByRole("combobox", {
        name: "Service workspace",
      });
      await serviceWorkspace.click();
      await page
        .getByRole("option", {
          name: servedWorkspace.workspaceName,
          exact: true,
        })
        .click();
      summary.initialContact = "local Mailpit only";
    } else
      summary.initialContactReason = "No served workspace option was available";
  }

  const projectQuota = page.getByLabel("Projects", { exact: true });
  await projectQuota.fill("not-a-number");
  let createRequestCount = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/instance/organisations"
    )
      createRequestCount += 1;
  });
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page.getByText(/whole number of zero or more/u)).toBeVisible();
  expect(createRequestCount).toBe(0);
  let organisationId: string | null = null;
  if (existingFixture) {
    await page
      .getByRole("button")
      .filter({ hasText: existingFixture.name })
      .click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      existingFixture.name,
    );
    organisationId = new URL(page.url()).searchParams.get("organisationId");
  } else {
    await projectQuota.fill("200");
    await page.getByRole("button", { name: "Create organisation" }).click();
    await expect(page).toHaveURL(/organisationId=/u);
    organisationId = new URL(page.url()).searchParams.get("organisationId");
  }
  if (!organisationId) throw new Error("Created organisation was not selected");
  const profileUrl = `${agentOrigin}/god-mode/organisations?organisationId=${encodeURIComponent(organisationId)}`;
  const catalogueCheckbox = page.getByRole("checkbox", {
    name: selectedType.name,
    exact: true,
  });
  await expect(catalogueCheckbox).toHaveAttribute("aria-checked", "true");
  if (!existingFixture && summary.initialContact === "local Mailpit only")
    await expect(
      page.getByText("Invitation queued.", { exact: true }),
    ).toBeVisible();
  if (smtpGate.confirmed) {
    const mailpitAfter = await readSmtpGate(page);
    summary.mailpitMessageObserved =
      smtpGate.messageCount !== null &&
      mailpitAfter.messageCount !== null &&
      mailpitAfter.messageCount > smtpGate.messageCount;
  }

  const stalePage = await browser.newPage({
    colorScheme: "light",
    ignoreHTTPSErrors: false,
    locale: "en-US",
    reducedMotion: "reduce",
    storageState: path.join(stateRoot, "admin-state.json"),
    viewport: { width: 1440, height: 1000 },
  });
  await stalePage.goto(profileUrl, { waitUntil: "domcontentloaded" });
  const originalName = existingFixture?.name ?? organisationName;
  await expect(stalePage.getByLabel("Name", { exact: true })).toHaveValue(
    originalName,
  );

  const updatedName = `${organisationName} Updated ${timestamp}`;
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    originalName,
  );
  await page.getByLabel("Name", { exact: true }).fill(updatedName);
  await page.getByRole("button", { name: "Save organisation" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    updatedName,
  );

  await stalePage
    .getByLabel("Name", { exact: true })
    .fill(`${originalName} Stale`);
  await stalePage.getByRole("button", { name: "Save organisation" }).click();
  await expect(
    stalePage.getByText("This organisation changed. Reload before saving.", {
      exact: true,
    }),
  ).toBeVisible();
  await stalePage.screenshot({
    path: path.join(evidenceRoot, `cas-conflict-${timestamp}.png`),
    fullPage: true,
  });
  (summary.screenshots as string[]).push(`cas-conflict-${timestamp}.png`);
  await stalePage.getByRole("button", { name: "Reload organisation" }).click();
  await expect(stalePage.getByLabel("Name", { exact: true })).toHaveValue(
    updatedName,
  );
  await stalePage.close();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    updatedName,
  );
  const identityLink = page.getByRole("link", {
    name: "Organisation",
    exact: true,
  });
  await identityLink.click();
  await expect(page).toHaveURL(/\/god-mode\/organisations\/[^/]+\/identity/u);
  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    updatedName,
  );

  await page.getByRole("button", { name: "Suspend organisation" }).click();
  const suspendResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/suspend"),
  );
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  const suspendResponse = await suspendResponsePromise;
  expect(suspendResponse.status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Reactivate organisation" }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Reactivate organisation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reactivate organisation" }).click();
  const reactivateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/unsuspend"),
  );
  await page.getByRole("button", { name: "Reactivate", exact: true }).click();
  const reactivateResponse = await reactivateResponsePromise;
  expect(reactivateResponse.status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Suspend organisation" }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Suspend organisation" }),
  ).toBeVisible();
  summary.lifecycle =
    "create, edit, reload, stale CAS conflict, identity route, suspend, reactivate passed";

  const postDirectory = await readDirectory(page);
  const priorAfter = {
    data: postDirectory.data.filter(
      (organisation) => organisation.id !== organisationId,
    ),
  } as Directory;
  const after = directorySignature(priorAfter);
  expect(after).toEqual({ count: before.count, digest: before.digest });
  summary.preExistingDirectory = {
    countBefore: before.count,
    countAfterExcludingQAFixture: after.count,
    mappingsAndProfilesUnchanged: true,
    digest: after.digest,
  };

  const activeWorkspaceName = await page.evaluate(async () => {
    const response = await fetch("/api/workspace", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const workspaces = (await response.json()) as Array<{
      id: string;
      name: string;
    }>;
    const sessionResponse = await fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!sessionResponse.ok) return null;
    const session = (await sessionResponse.json()) as {
      session?: { activeOrganizationId?: string | null };
    };
    const activeId = session.session?.activeOrganizationId;
    return (
      workspaces.find((workspace) => workspace.id === activeId)?.name ?? null
    );
  });
  await page.getByRole("button", { name: "Back to Workspace" }).click();
  await expect(page).toHaveURL(`${agentOrigin}/agent`);
  const projectListProbe = await page.evaluate(
    async ({ workspaceId, projectKey }) => {
      const response = await fetch(
        `/api/project?workspaceId=${encodeURIComponent(workspaceId ?? "")}`,
        { credentials: "include", cache: "no-store" },
      );
      return {
        method: "GET",
        path: new URL(response.url).pathname + new URL(response.url).search,
        status: response.status,
        traceId:
          response.headers.get("x-request-id") ??
          response.headers.get("x-trace-id") ??
          response.headers.get("x-correlation-id"),
        matchingProject: response.ok
          ? ((
              (await response.json()) as Array<{
                id: string;
                slug: string;
                organisationId: string | null;
              }>
            ).find((project) => project.slug === projectKey) ?? null)
          : null,
      };
    },
    { workspaceId: sessionShape, projectKey },
  );
  summary.projectListProbe = {
    method: projectListProbe.method,
    path: projectListProbe.path,
    status: projectListProbe.status,
    traceIdAvailable: projectListProbe.traceId !== null,
    matchingOwnedProjectFound: projectListProbe.matchingProject !== null,
  };
  expect(projectListProbe.status).toBe(200);
  const projectRecord = projectListProbe.matchingProject;
  expect(projectRecord?.organisationId).toBe(organisationId);
  const projectId = projectRecord?.id;
  if (!projectId) throw new Error("Created project id missing from route");
  await page.goto(
    `${agentOrigin}/dashboard/workspace/${encodeURIComponent(sessionShape ?? "")}/project/${encodeURIComponent(projectId)}/board`,
    { waitUntil: "domcontentloaded" },
  );
  const project = await page.evaluate(async (id) => {
    const response = await fetch(`/api/project/${encodeURIComponent(id)}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Project read returned ${response.status}`);
    return (await response.json()) as {
      organisationId: string | null;
      serviceCalendarId: string | null;
      slaPolicyId?: string | null;
    };
  }, projectId);
  expect(project.organisationId).toBe(organisationId);
  expect(project.serviceCalendarId).toBe(defaultCalendar?.id ?? null);
  if (defaultSla && project.slaPolicyId !== undefined)
    expect(project.slaPolicyId).toBe(defaultSla.id);
  summary.projectDefaults = {
    projectCreatedThroughKaneoModal: true,
    workspaceName: activeWorkspaceName,
    serviceCalendarCopied: defaultCalendar?.name ?? null,
    slaPolicyCopied: defaultSla?.name ?? null,
    serviceCalendarPersisted:
      project.serviceCalendarId === (defaultCalendar?.id ?? null),
    slaPolicyPersisted:
      project.slaPolicyId === undefined
        ? "not exposed by current project read DTO"
        : project.slaPolicyId === (defaultSla?.id ?? null),
  };
  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    updatedName,
  );

  const screenshots = summary.screenshots as string[];
  for (const width of [375, 768, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((selectedTheme) => {
        const key = "user-preferences";
        const raw = window.localStorage.getItem(key);
        const stored = raw
          ? (JSON.parse(raw) as { state?: Record<string, unknown> })
          : { state: {} };
        if (!stored.state || typeof stored.state !== "object")
          throw new Error("User preferences storage is not an object");
        stored.state.theme = selectedTheme;
        window.localStorage.setItem(key, JSON.stringify(stored));
      }, theme);
      await page.setViewportSize({ width, height: 1000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
        updatedName,
      );
      await expect(
        page
          .getByRole("combobox", { name: "Service calendar" })
          .filter({ hasText: defaultCalendar?.name ?? "" }),
      ).toBeVisible();
      if (defaultSla)
        await expect(
          page
            .getByRole("combobox", { name: "SLA policy" })
            .filter({ hasText: defaultSla.name }),
        ).toBeVisible();
      const captureName = `organisation-lifecycle-${width}-${theme}-${timestamp}.png`;
      await page.screenshot({
        path: path.join(evidenceRoot, captureName),
        fullPage: true,
      });
      screenshots.push(captureName);
    }
  }
  summary.responsive = {
    widths: [375, 768, 1440],
    themes: ["light", "dark"],
    actualLabelsVisible: true,
  };
  summary.result = "passed";
  await writeFile(
    path.join(evidenceRoot, `organisation-lifecycle-${timestamp}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
});

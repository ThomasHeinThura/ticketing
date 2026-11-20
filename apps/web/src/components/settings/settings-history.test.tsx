import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { settingsHistoryQueryKey } from "@/fetchers/settings/settings-history";
import { HttpError } from "@/lib/http-error";
import { SettingsHistory } from "./settings-history";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/settings/settings-history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/settings/settings-history")
  >()),
  getSettingsHistory: get,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { id: currentUser.id },
        session: { id: currentUser.sessionId },
      },
    }),
  },
}));
const currentUser = { id: "u1", sessionId: "s1" };
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
// The same word is the correct translation here, so equality is legitimate.
const sameAsEnglish = new Set(["de-DE:name"]);
const catalog = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
function lookup(source: Record<string, unknown> | null, key: string) {
  const [ns, path] = key.split(":");
  let node: unknown = source?.[ns ?? ""];
  for (const part of (path ?? "").split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === "string" ? node : undefined;
}
const fromCatalog = (key: string) => lookup(catalog.current, key);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      options?: { defaultValue?: string; actor?: string; at?: string },
    ) =>
      (fromCatalog(_key) ?? options?.defaultValue ?? _key)
        .replace("{{actor}}", options?.actor ?? "")
        .replace("{{at}}", options?.at ?? ""),
  }),
}));

const row = {
  at: "2026-01-01T00:00:00Z",
  actor: { kind: "person", name: "Alice" },
  action: "workspace.settings_updated",
  changedFields: ["name", "secret_raw"],
};
function setup(userId = "u1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsHistory type="workspace" id="w1" userId={userId} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
describe("SettingsHistory", () => {
  it("revalidates before disclosing previously loaded history after reach is revoked", async () => {
    get.mockReset().mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [row],
    });
    let rejectRead: (error: Error) => void = () => {};
    get.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    const { client } = setup();
    await screen.findByText(/Last changed by Alice/);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText(/Last changed by Alice|Workspace settings updated/),
    ).toBeNull();
    await act(async () => rejectRead(new HttpError(403, "Forbidden")));
    expect(
      screen.queryByText(/Last changed by Alice|Workspace settings updated/),
    ).toBeNull();
    expect(
      client.getQueryData(
        settingsHistoryQueryKey("workspace", "w1", "u1", "s1"),
      ),
    ).toBeNull();
  });

  it("does not admit an older disclosure after a second opening", async () => {
    let finish: (value: unknown) => void = () => {};
    const old = {
      entityType: "workspace",
      entityId: "w1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [row],
    };
    const fresh = {
      ...old,
      lastChanged: {
        actor: { kind: "person", name: "Fresh reader" },
        at: row.at,
      },
      rows: [],
    };
    get
      .mockReset()
      .mockResolvedValueOnce(old)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(fresh);
    setup();
    await screen.findByText(/Last changed by Alice/);
    const button = screen.getByRole("button", { name: /History/ });
    fireEvent.click(button);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(/Last changed by Fresh reader/);
    await act(async () => finish(old));
    expect(screen.queryByText(/Alice/)).toBeNull();
  });

  it("does not admit a pending disclosure after the session changes", async () => {
    let finish: (value: unknown) => void = () => {};
    const old = {
      entityType: "workspace",
      entityId: "w1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [row],
    };
    const fresh = {
      ...old,
      lastChanged: { actor: { kind: "person", name: "New user" }, at: row.at },
      rows: [],
    };
    get
      .mockReset()
      .mockResolvedValueOnce(old)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(fresh);
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    const { rerender, client } = setup();
    await screen.findByText(/Last changed by Alice/);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    currentUser.sessionId = "s2";
    rerender(
      <QueryClientProvider client={client}>
        <SettingsHistory type="workspace" id="w1" userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by New user/);
    await act(async () => finish(old));
    expect(screen.queryByText(/Alice/)).toBeNull();
    currentUser.sessionId = "s1";
  });

  it("shows attribution and keyboard disclosure without raw fields or values", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockResolvedValue({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [row],
    });
    setup();
    expect(await screen.findByText(/Last changed by Alice/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /History/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(button, { key: "Enter", code: "Enter" });
    // jsdom does not synthesize the native button click for Enter.
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(screen.getByText(/Workspace settings updated/)).toBeTruthy(),
    );
    expect(screen.queryByText(/secret_raw/)).toBeNull();
    expect(
      errors.mock.calls.some((args) =>
        args.some((value) => String(value).includes("nativeButton")),
      ),
    ).toBe(false);
    errors.mockRestore();
  });
  it("renders allowed project fields as readable labels without values", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValue({
      entityType: "project",
      entityId: "p1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [
        {
          ...row,
          action: "project.general_updated",
          changedFields: ["serviceCalendarId", "stateSetMode", "privateField"],
          after: { secret: "hidden-value" },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type="project" id="p1" userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Alice/);
    expect(get).toHaveBeenCalledWith("project", "p1", expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(
      await screen.findByText(
        /settings:history.fields.serviceCalendar, settings:history.fields.stateSetMode/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/privateField|hidden-value|serviceCalendarId/),
    ).toBeNull();
  });
  it("shows only the two approved workflow field labels", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValue({
      entityType: "workflow",
      entityId: "wf1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [
        {
          ...row,
          action: "workflow.version_published",
          changedFields: ["definition", "activeVersion", "secret_raw"],
          after: { secret: "hidden-value" },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type="workflow" id="wf1" userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Alice/);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(
      await screen.findByText(
        /settings:history.fields.workflowDefinition, settings:history.fields.workflowActiveVersion/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/secret_raw|hidden-value|activeVersion/),
    ).toBeNull();
  });
  it("shows only the three approved canned response field labels, no values", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValue({
      entityType: "canned_response",
      entityId: "c1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [
        {
          ...row,
          action: "canned_response.updated",
          changedFields: ["name", "body", "visibilityDefault", "secret_raw"],
          after: { body: "hidden-value" },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type="canned_response" id="c1" userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Alice/);
    expect(get).toHaveBeenCalledWith(
      "canned_response",
      "c1",
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(await screen.findByText(/Canned response updated/)).toBeTruthy();
    expect(
      screen.getByText(
        "settings:cannedResponses.name, settings:cannedResponses.body, settings:cannedResponses.visibility",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/secret_raw|hidden-value/)).toBeNull();
  });
  it("shows only the two approved time activity field labels as existing time-tracking labels, no values", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValue({
      entityType: "time_activity",
      entityId: "ta1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [
        {
          ...row,
          action: "time_activity.updated",
          changedFields: ["name", "archived", "position", "secret_raw"],
          after: { name: "hidden-value" },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type="time_activity" id="ta1" userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Alice/);
    expect(get).toHaveBeenCalledWith(
      "time_activity",
      "ta1",
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(
      await screen.findByText(
        "settings:history.fields.activity, settings:history.fields.archived",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/position|secret_raw|hidden-value/)).toBeNull();
  });
  it("shows only the 18 projected instance setting keys as existing General labels, never values or raw keys", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    const projected = [
      "approvalDefaultExpiryDays",
      "clarificationWindowDays",
      "reopenWindowDays",
      "notificationRetentionDays",
      "cspMode",
      "invitationLifetimeHours",
      "customerInvitationCreateWindowMinutes",
      "customerInvitationPerInviterLimit",
      "customerInvitationPerOrganisationLimit",
      "customerInvitationResendCooldownSeconds",
      "anonymousRateLimitWindowMs",
      "anonymousRateLimitMax",
      "mcpWriteCeilingPerMinute",
      "apiKeyBurstThreshold",
      "timezone",
      "attachmentMaxBytes",
      "attachmentMaxPerItem",
      "attachmentAllowedExtensions",
    ];
    get.mockReset();
    get.mockResolvedValue({
      entityType: "instance",
      entityId: "singleton",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [
        {
          ...row,
          action: "instance.settings_changed",
          changedFields: [...projected, "clientSecret", "secret_raw"],
          after: { timezone: "hidden-value" },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type="instance" id="singleton" userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Alice/);
    expect(get).toHaveBeenCalledWith(
      "instance",
      "singleton",
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    const expected = projected
      .map(
        (field) =>
          `godModeSettings:fields.${field === "anonymousRateLimitWindowMs" ? "anonymousRateLimitWindowMinutes" : field}.label`,
      )
      .join(", ");
    expect(await screen.findByText(expected)).toBeTruthy();
    // The row title is the translated Saved label, never the untranslated English fallback.
    expect(screen.getByText(/common:actions\.saved/)).toBeTruthy();
    expect(screen.queryByText(/Instance settings changed/)).toBeNull();
    expect(
      screen.queryByText(/clientSecret|secret_raw|hidden-value/),
    ).toBeNull();
  });
  it("has localized instance History labels in every catalog", () => {
    const read = (name: string) =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), `../../i18n/${name}.json`), "utf8"),
      ) as Record<string, unknown>;
    const locales = readdirSync(resolve(process.cwd(), "../../i18n"))
      .filter((file) => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file))
      .map((file) => file.replace(".json", ""));
    expect(locales).toHaveLength(19);
    for (const locale of locales) {
      const own = read(locale);
      for (const field of [
        "approvalDefaultExpiryDays",
        "clarificationWindowDays",
        "reopenWindowDays",
        "notificationRetentionDays",
        "cspMode",
        "invitationLifetimeHours",
        "customerInvitationCreateWindowMinutes",
        "customerInvitationPerInviterLimit",
        "customerInvitationPerOrganisationLimit",
        "customerInvitationResendCooldownSeconds",
        "anonymousRateLimitWindowMinutes",
        "anonymousRateLimitMax",
        "mcpWriteCeilingPerMinute",
        "apiKeyBurstThreshold",
        "timezone",
        "attachmentMaxBytes",
        "attachmentMaxPerItem",
        "attachmentAllowedExtensions",
      ]) {
        const key = `godModeSettings:fields.${field}.label`;
        expect(lookup(own, key), `${locale} ${key}`).toBeTruthy();
      }
      // The row title key the renderer uses for instance History.
      expect(
        lookup(own, "common:actions.saved"),
        `${locale} common:actions.saved`,
      ).toBeTruthy();
    }
  });
  it("has localized time activity History labels in every non-English catalog", () => {
    const read = (name: string) =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), `../../i18n/${name}.json`), "utf8"),
      ) as Record<string, unknown>;
    const locales = readdirSync(resolve(process.cwd(), "../../i18n"))
      .filter((file) => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file))
      .map((file) => file.replace(".json", ""));
    expect(locales).toHaveLength(19);
    for (const locale of locales) {
      const own = read(locale);
      for (const key of [
        "settings:history.fields.activity",
        "settings:history.fields.archived",
      ])
        expect(lookup(own, key), `${locale} ${key}`).toBeTruthy();
    }
  });
  it("localizes all three canned response field labels in every non-English catalog", () => {
    const read = (name: string) =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), `../../i18n/${name}.json`), "utf8"),
      ) as Record<string, unknown>;
    const en = read("en-US");
    const locales = readdirSync(resolve(process.cwd(), "../../i18n"))
      .filter((file) => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file))
      .map((file) => file.replace(".json", ""))
      .filter((locale) => locale !== "en-US");
    expect(locales).toHaveLength(18);
    for (const locale of locales) {
      const own = read(locale);
      for (const field of ["name", "body", "visibility"]) {
        const key = `settings:cannedResponses.${field}`;
        const value = lookup(own, key);
        expect(value, `${locale} ${key}`).toBeTruthy();
        if (!sameAsEnglish.has(`${locale}:${field}`))
          expect(value, `${locale} ${key}`).not.toBe(lookup(en, key));
      }
      for (const action of ["created", "updated", "deleted"]) {
        const key = `workItems:auditHistory.actions.canned_response_${action}`;
        expect(lookup(own, key), `${locale} ${key}`).not.toBe(lookup(en, key));
      }
    }
  });
  it.each(["de-DE", "ja-JP", "zh-CN"])(
    "renders canned response History from the %s catalog, not English fallbacks",
    async (locale) => {
      currentUser.id = "u1";
      currentUser.sessionId = "s1";
      const read = (name: string) =>
        JSON.parse(
          readFileSync(
            resolve(process.cwd(), `../../i18n/${name}.json`),
            "utf8",
          ),
        ) as Record<string, unknown>;
      const own = read(locale);
      const en = read("en-US");
      catalog.current = own;
      try {
        get.mockResolvedValue({
          entityType: "canned_response",
          entityId: "c1",
          lastChanged: { actor: row.actor, at: row.at },
          rows: [
            {
              ...row,
              action: "canned_response.created",
              changedFields: ["name", "body", "visibilityDefault"],
            },
          ],
        });
        const client = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        render(
          <QueryClientProvider client={client}>
            <SettingsHistory type="canned_response" id="c1" userId="u1" />
          </QueryClientProvider>,
        );
        // The shared strings come from the selected catalog too; an unresolved lookup must fail, not match anything.
        const summary = lookup(own, "settings:history.lastChanged");
        const title = lookup(own, "settings:history.title");
        if (!summary || !title) throw new Error(`${locale} History strings`);
        await screen.findByText(
          summary.replace("{{actor}}", "Alice").replace("{{at}}", row.at),
        );
        expect(screen.queryByText(/Last changed by/)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: title }));
        const key = (name: string) => `settings:cannedResponses.${name}`;
        const labels = ["name", "body", "visibility"]
          .map((name) => lookup(own, key(name)))
          .join(", ");
        for (const name of ["name", "body", "visibility"])
          if (!sameAsEnglish.has(`${locale}:${name}`))
            expect(lookup(own, key(name))).not.toBe(lookup(en, key(name)));
        expect(await screen.findByText(labels)).toBeTruthy();
        const action = lookup(
          own,
          "workItems:auditHistory.actions.canned_response_created",
        );
        expect(action).toBeTruthy();
        expect(screen.getByText(new RegExp(action ?? "missing"))).toBeTruthy();
        expect(
          screen.queryByText(/Response body|Default visibility/),
        ).toBeNull();
      } finally {
        catalog.current = null;
      }
    },
  );
  it("shows only closed automation fields as existing labels, never values or scope", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValue({
      entityType: "automation",
      entityId: "au1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [
        {
          ...row,
          action: "automation.updated",
          changedFields: [
            "name",
            "enabled",
            "trigger",
            "scheduleCron",
            "conditions",
            "actions",
            "effectiveRoleId",
            "stopProcessing",
            "projectFilter",
            "position",
            "secret_raw",
          ],
          after: { actions: "hidden-value" },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type="automation" id="au1" userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Alice/);
    expect(get).toHaveBeenCalledWith(
      "automation",
      "au1",
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(await screen.findByText(/Automation updated/)).toBeTruthy();
    expect(
      screen.getByText(
        [
          "automations:editor.name",
          "automations:list.enabled",
          "automations:editor.when",
          "automations:editor.schedule",
          "automations:editor.if",
          "automations:editor.then",
          "automations:editor.runAs",
          "automations:editor.stopProcessing",
        ].join(", "),
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/secret_raw|hidden-value|projectFilter|position/),
    ).toBeNull();
  });
  it("has localized automation History labels in every non-English catalog", () => {
    const read = (name: string) =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), `../../i18n/${name}.json`), "utf8"),
      ) as Record<string, unknown>;
    const en = read("en-US");
    const keys = [
      "workItems:auditHistory.actions.automation_created",
      "workItems:auditHistory.actions.automation_updated",
      "workItems:auditHistory.actions.automation_enabled",
      "workItems:auditHistory.actions.automation_disabled",
      "automations:list.changeHistory",
      "automations:changes.title",
      "automations:changes.description",
    ];
    const locales = readdirSync(resolve(process.cwd(), "../../i18n"))
      .filter((file) => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file))
      .map((file) => file.replace(".json", ""))
      .filter((locale) => locale !== "en-US");
    expect(locales).toHaveLength(18);
    for (const locale of locales) {
      const own = read(locale);
      for (const key of keys) {
        expect(lookup(own, key), `${locale} ${key}`).toBeTruthy();
        expect(lookup(own, key), `${locale} ${key}`).not.toBe(lookup(en, key));
      }
    }
  });
  it("retries a failed request and shows empty history", async () => {
    get.mockRejectedValueOnce(new Error("private")).mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: null,
      rows: [],
    });
    setup();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("private")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No recorded changes yet.")).toBeTruthy();
  });
  it.each([401, 403, 404])(
    "removes only refused target data on %s and retains retry",
    async (status) => {
      currentUser.id = "u1";
      currentUser.sessionId = "s1";
      get.mockReset().mockResolvedValue({
        entityType: "workspace",
        entityId: "w1",
        lastChanged: { actor: row.actor, at: row.at },
        rows: [row],
      });
      const { client } = setup();
      const key = ["settings-history", "workspace", "w1", "agent", "u1", "s1"];
      const other = [
        "settings-history",
        "workspace",
        "other",
        "agent",
        "u1",
        "s1",
      ];
      client.setQueryData(other, { private: "other" });
      expect(await screen.findByText(/Last changed by Alice/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /History/ }));
      expect(
        await screen.findByText(/Workspace settings updated/),
      ).toBeTruthy();
      get.mockRejectedValueOnce(new HttpError(status, "denied"));
      await client.invalidateQueries({ queryKey: key, exact: true });
      await screen.findByRole("alert");
      expect(screen.queryByText(/Alice/)).toBeNull();
      expect(screen.queryByText(/Workspace settings updated/)).toBeNull();
      expect(client.getQueryData(key)).toBeNull();
      expect(client.getQueryData(other)).toEqual({ private: "other" });
      get.mockResolvedValueOnce({
        entityType: "workspace",
        entityId: "w1",
        lastChanged: null,
        rows: [],
      });
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("No recorded changes yet.")).toBeTruthy();
    },
  );
  it("hides cached data on a transient error and recovers on Retry", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [row],
    });
    const { client } = setup();
    await screen.findByText(/Last changed by Alice/);
    get.mockRejectedValueOnce(new HttpError(503, "unavailable"));
    await client.invalidateQueries({
      queryKey: ["settings-history", "workspace", "w1"],
    });
    await screen.findByRole("alert");
    // A failed current read no longer vouches for the earlier result: it stays hidden.
    expect(screen.queryByText(/Last changed by Alice/)).toBeNull();
    get.mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [row],
    });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await screen.findByText(/Last changed by Alice/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not show another target or session while its history loads", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: { actor: row.actor, at: row.at },
      rows: [row],
    });
    get.mockImplementation(() => new Promise(() => {}));
    const { client, rerender } = setup();
    await screen.findByText(/Last changed by Alice/);
    rerender(
      <QueryClientProvider client={client}>
        <SettingsHistory type="workspace" id="w2" userId="u1" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/Alice/)).toBeNull();
    currentUser.sessionId = "s2";
    rerender(
      <QueryClientProvider client={client}>
        <SettingsHistory type="workspace" id="w1" userId="u1" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/Alice/)).toBeNull();
  });
  it("separates cached results by identity", async () => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValue({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: null,
      rows: [],
    });
    const { client, rerender } = setup();
    await screen.findByText("No recorded changes yet.");
    currentUser.id = "u2";
    currentUser.sessionId = "s2";
    rerender(
      <QueryClientProvider client={client}>
        <SettingsHistory type="workspace" id="w1" userId="u2" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        client.getQueryData([
          "settings-history",
          "workspace",
          "w1",
          "agent",
          "u2",
          "s2",
        ]),
      ).toBeTruthy(),
    );
  });
});
it("ignores an obsolete denied read after a newer history response", async () => {
  currentUser.id = "u1";
  currentUser.sessionId = "s1";
  get.mockReset();
  let denyOld!: (error: Error) => void;
  get
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          denyOld = reject;
        }),
    )
    .mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "w1",
      lastChanged: null,
      rows: [],
    });
  const { client } = setup();
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  const key = ["settings-history", "workspace", "w1", "agent", "u1", "s1"];
  const { refreshSettingsHistory } = await import("./refresh-settings-history");
  refreshSettingsHistory(client, key, async () => {});
  await screen.findByText("No recorded changes yet.");
  denyOld(new HttpError(403, "old refusal"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.getQueryData(key)).toMatchObject({ entityId: "w1" });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("renders only the closed membership role marker and localized action", async () => {
  get.mockResolvedValue({
    entityType: "workspace_member",
    entityId: "row",
    lastChanged: null,
    rows: [
      {
        at: "2026-01-01T00:00:00Z",
        actor: { kind: "system", name: null },
        action: "membership.changed",
        changedFields: ["role", "private_id"],
      },
    ],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsHistory type="workspace_member" id="row" userId="u1" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /History/ }));
  await waitFor(() =>
    expect(screen.getByText(/settings:history.roleChanged/)).toBeTruthy(),
  );
  expect(screen.getByText("settings:projectMembers.role")).toBeTruthy();
  expect(screen.queryByText(/private_id/)).toBeNull();
});

it("isolates one terminology cell across instance and workspaces", async () => {
  get.mockReset();
  currentUser.id = "u1";
  currentUser.sessionId = "s1";
  get.mockImplementation(
    async (
      _type: string,
      id: string,
      _signal: AbortSignal,
      selector: { scope: string; workspaceId?: string },
    ) => ({
      entityType: "terminology_override",
      entityId: id,
      lastChanged: {
        actor: {
          kind: "person",
          name: selector.workspaceId ?? "Instance actor",
        },
        at: row.at,
      },
      rows: [],
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderTarget = (
    selector:
      | { scope: "instance" }
      | { scope: "workspace"; workspaceId: string },
  ) => (
    <QueryClientProvider client={client}>
      <SettingsHistory
        type="terminology_override"
        id="request:both:en-US"
        userId="u1"
        selector={selector}
      />
    </QueryClientProvider>
  );
  const view = render(renderTarget({ scope: "instance" }));
  await screen.findByText(/Instance actor/);
  view.rerender(renderTarget({ scope: "workspace", workspaceId: "w1" }));
  expect(screen.queryByText(/Instance actor/)).toBeNull();
  await screen.findByText(/w1/);
  view.rerender(renderTarget({ scope: "workspace", workspaceId: "w2" }));
  expect(screen.queryByText(/w1/)).toBeNull();
  await screen.findByText(/w2/);
  expect(get).toHaveBeenCalledTimes(3);
});

it.each([
  ["terminology_override", "request:both:en-US", { scope: "instance" }],
  ["project_estimates", "project-id", undefined],
] as const)(
  "renders %s as action and time only",
  async (type, id, selector) => {
    get.mockReset();
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockResolvedValue({
      entityType: type,
      entityId: id,
      lastChanged: { actor: row.actor, at: row.at },
      rows: [
        {
          ...row,
          action:
            type === "terminology_override"
              ? "terminology.changed"
              : "estimate.configured",
          changedFields: ["forms", "system", "points", "secret_raw"],
          after: { forms: "private noun", points: "private scale" },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type={type} id={id} userId="u1" selector={selector} />
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Alice/);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(await screen.findByText(/common:actions.saved/)).toBeTruthy();
    expect(
      screen.queryByText(/private noun|private scale|secret_raw|forms|points/),
    ).toBeNull();
  },
);

it("renders only the provider configuration and credential categories", async () => {
  currentUser.id = "u1";
  currentUser.sessionId = "s1";
  get.mockReset().mockResolvedValue({
    entityType: "instance_notification_provider",
    entityId: "provider",
    lastChanged: null,
    rows: [
      {
        ...row,
        action: "plugin.changed",
        changedFields: ["configuration", "credential", "enabled", "secret_raw"],
      },
    ],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsHistory
        type="instance_notification_provider"
        id="provider"
        userId="u1"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /History/ }));
  await waitFor(() =>
    expect(
      screen.getByText(
        "settings:history.providerConfiguration, settings:history.providerCredential",
      ),
    ).toBeTruthy(),
  );
  expect(screen.queryByText(/secret_raw|enabled/)).toBeNull();
});

it("provides the provider History labels in all 19 catalogs", () => {
  const locales = readdirSync(resolve(process.cwd(), "../../i18n")).filter(
    (file) => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file),
  );
  expect(locales).toHaveLength(19);
  for (const locale of locales) {
    const data = JSON.parse(
      readFileSync(resolve(process.cwd(), `../../i18n/${locale}`), "utf8"),
    ) as Record<string, unknown>;
    for (const key of [
      "settings:history.providerConfiguration",
      "settings:history.providerCredential",
      "workItems:auditHistory.actions.plugin_changed",
    ]) {
      expect(lookup(data, key), `${locale} ${key}`).toBeTruthy();
    }
  }
});

it.each([
  [
    "workspace",
    "backdateLimitDays",
    "settings:history.fields.backdateLimit",
    "projectDefaultBillable",
  ],
  [
    "project",
    "projectDefaultBillable",
    "settings:history.fields.defaultBillable",
    "backdateLimitDays",
  ],
] as const)(
  "shows only the verified %s time marker without values",
  async (type, marker, label, crossMarker) => {
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    get.mockReset().mockResolvedValue({
      entityType: type,
      entityId: "target",
      lastChanged: null,
      rows: [
        {
          ...row,
          action: "time_settings.updated",
          changedFields: [marker, crossMarker, "name", "secret_raw"],
          after: {
            from: "private-value",
            to: "private-value",
            projectId: "private-id",
          },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type={type} id="target" userId="u1" />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /History/ }));
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
    expect(
      screen.queryByText(/private-value|private-id|secret_raw/),
    ).toBeNull();
    expect(screen.queryByText("Name")).toBeNull();
  },
);

it("keeps legacy time-setting rows to action and time when no verified marker exists", async () => {
  currentUser.id = "u1";
  currentUser.sessionId = "s1";
  get.mockReset().mockResolvedValue({
    entityType: "workspace",
    entityId: "target",
    lastChanged: null,
    rows: [
      {
        ...row,
        action: "time_settings.updated",
        changedFields: [],
        after: { backdateLimitDays: { from: 1, to: 2 } },
      },
    ],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsHistory type="workspace" id="target" userId="u1" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /History/ }));
  await waitFor(() =>
    expect(screen.getByText(/Time settings updated/)).toBeTruthy(),
  );
  expect(
    screen.queryByText("settings:history.fields.backdateLimit"),
  ).toBeNull();
});

it("localizes the time-settings action in all 19 catalogs", () => {
  const locales = readdirSync(resolve(process.cwd(), "../../i18n")).filter(
    (file) => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file),
  );
  expect(locales).toHaveLength(19);
  const values = locales.map((locale) => {
    const data = JSON.parse(
      readFileSync(resolve(process.cwd(), `../../i18n/${locale}`), "utf8"),
    ) as Record<string, unknown>;
    const value = lookup(
      data,
      "workItems:auditHistory.actions.time_settings_updated",
    );
    expect(value, locale).toBeTruthy();
    return [locale, value] as const;
  });
  const english = values.find(([locale]) => locale === "en-US.json")?.[1];
  for (const [locale, value] of values)
    if (locale !== "en-US.json") expect(value, locale).not.toBe(english);
});

it.each(["de-DE", "ja-JP", "zh-CN"])(
  "renders the localized %s time-settings action",
  async (locale) => {
    const data = JSON.parse(
      readFileSync(resolve(process.cwd(), `../../i18n/${locale}.json`), "utf8"),
    ) as Record<string, unknown>;
    currentUser.id = "u1";
    currentUser.sessionId = "s1";
    catalog.current = data;
    try {
      get.mockReset().mockResolvedValue({
        entityType: "workspace",
        entityId: "target",
        lastChanged: null,
        rows: [{ ...row, action: "time_settings.updated", changedFields: [] }],
      });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <SettingsHistory type="workspace" id="target" userId="u1" />
        </QueryClientProvider>,
      );
      const title = lookup(data, "settings:history.title");
      if (!title) throw new Error(`${locale} History title`);
      fireEvent.click(await screen.findByRole("button", { name: title }));
      const label = lookup(
        data,
        "workItems:auditHistory.actions.time_settings_updated",
      );
      await waitFor(() =>
        expect(screen.getByText(new RegExp(label ?? "missing"))).toBeTruthy(),
      );
      expect(screen.queryByText(/Time settings updated/)).toBeNull();
    } finally {
      catalog.current = null;
    }
  },
);

// Shared renderer: cached History must never show before a settled read of the current mount
// (the app's query client sets refetchOnMount: false, so the mount read is part of the contract).
describe.each([
  "workspace",
  "project",
  "canned_response",
  "automation",
  "time_activity",
  "instance",
] as const)(
  "%s History admits cached data only after a settled current read",
  (type) => {
    const entryFor = (name: string, at: string) => ({
      entityType: type,
      entityId: "target",
      lastChanged: { actor: { kind: "person", name }, at },
      rows: [
        {
          at,
          actor: { kind: "person", name },
          action: `${type}.updated`,
          changedFields: ["name"],
        },
      ],
    });
    const privateEntry = entryFor("Private Pat", "2026-01-01T00:00:00Z");
    const fresh = entryFor("Fresh Fran", "2026-02-01T00:00:00Z");
    const appClient = () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnMount: false,
            refetchOnWindowFocus: false,
          },
        },
      });
    const keyOf = (user = "u1", session = "s1") =>
      settingsHistoryQueryKey(type, "target", user, session);
    function mountSeeded(client = appClient(), userId = "u1") {
      currentUser.id = "u1";
      currentUser.sessionId = "s1";
      client.setQueryData(
        keyOf(userId, userId === "u1" ? "s1" : ""),
        privateEntry,
      );
      return render(
        <QueryClientProvider client={client}>
          <SettingsHistory type={type} id="target" userId={userId} />
        </QueryClientProvider>,
      );
    }
    const noPrivate = () => {
      fireEvent.click(screen.getByRole("button", { name: /History/ }));
      expect(screen.queryByText(/Private Pat/)).toBeNull();
      expect(screen.queryByText(/Last changed by Private/)).toBeNull();
    };

    it("hides the seeded entry during a held mount read, then shows only the fresh result", async () => {
      let finish: (value: unknown) => void = () => {};
      get.mockReset();
      get.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      mountSeeded();
      await waitFor(() => expect(get).toHaveBeenCalledOnce());
      noPrivate();
      expect(screen.queryByText(/Last changed/)).toBeNull();
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      await act(async () => finish(fresh));
      await screen.findByText(/Last changed by Fresh Fran/);
      expect(screen.queryByText(/Private Pat/)).toBeNull();
    });

    it.each([
      ["refused 403", () => new HttpError(403, "denied")],
      ["a 500", () => new HttpError(500, "boom")],
    ])(
      "keeps the seeded entry hidden on %s, with an alert and a Retry that recovers",
      async (_name, error) => {
        get.mockReset();
        get.mockRejectedValueOnce(error()).mockResolvedValueOnce(fresh);
        mountSeeded();
        await screen.findByRole("alert");
        noPrivate();
        fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
        await screen.findByText(/Last changed by Fresh Fran/);
        expect(screen.queryByText(/Private Pat/)).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
      },
    );

    it("keeps the seeded entry hidden while the read is paused offline and shows only the resumed result", async () => {
      get.mockReset();
      get.mockResolvedValue(fresh);
      onlineManager.setOnline(false);
      try {
        mountSeeded();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(get).not.toHaveBeenCalled();
        noPrivate();
        expect(screen.queryByText(/Last changed/)).toBeNull();
        onlineManager.setOnline(true);
        await screen.findByText(/Last changed by Fresh Fran/);
        expect(screen.queryByText(/Private Pat/)).toBeNull();
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it("re-reads on every remount instead of replaying the previous mount's result", async () => {
      get.mockReset();
      get.mockResolvedValueOnce(fresh);
      const client = appClient();
      const first = mountSeeded(client);
      await screen.findByText(/Last changed by Fresh Fran/);
      first.unmount();
      let finish: (value: unknown) => void = () => {};
      get.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      render(
        <QueryClientProvider client={client}>
          <SettingsHistory type={type} id="target" userId="u1" />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(/Last changed/)).toBeNull();
      await act(async () =>
        finish(entryFor("Second Sam", "2026-03-01T00:00:00Z")),
      );
      await screen.findByText(/Last changed by Second Sam/);
    });

    it("neither reads nor shows cached data for another user or a missing session", async () => {
      get.mockReset();
      mountSeeded(appClient(), "u2");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(get).not.toHaveBeenCalled();
      noPrivate();
    });

    it("does not show another target's or session's cached entry while the current read is held", async () => {
      get.mockReset();
      get.mockImplementation(() => new Promise(() => {}));
      const client = appClient();
      client.setQueryData(keyOf("u1", "s-old"), privateEntry);
      client.setQueryData(
        settingsHistoryQueryKey(type, "other-target", "u1", "s1"),
        privateEntry,
      );
      currentUser.id = "u1";
      currentUser.sessionId = "s1";
      render(
        <QueryClientProvider client={client}>
          <SettingsHistory type={type} id="target" userId="u1" />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(get).toHaveBeenCalledOnce());
      noPrivate();
    });
  },
);

it("does not disclose cached metadata when a mutation refresh cancels the disclosure read", async () => {
  currentUser.id = "u1";
  currentUser.sessionId = "s1";
  const cached = {
    entityType: "workspace",
    entityId: "w1",
    lastChanged: { actor: row.actor, at: row.at },
    rows: [row],
  };
  get
    .mockReset()
    .mockResolvedValueOnce(cached)
    .mockImplementation(() => new Promise(() => {}));
  const { client } = setup();
  await screen.findByText(/Last changed by Alice/);
  fireEvent.click(screen.getByRole("button", { name: /History/ }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  const { refreshSettingsHistory } = await import("./refresh-settings-history");
  await act(async () => {
    refreshSettingsHistory(
      client,
      settingsHistoryQueryKey("workspace", "w1", "u1", "s1"),
      () => new Promise(() => {}),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByText(/Alice/)).toBeNull();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

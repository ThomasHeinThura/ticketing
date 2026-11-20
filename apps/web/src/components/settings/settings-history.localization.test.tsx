/**
 * Real-i18next localization check for the shared History panel: the real SettingsHistory, the real
 * catalogs of all 19 locales, an isolated i18next instance per locale with no English fallback (an
 * untranslated key falls to the renderer's English defaultValue and is caught). Only the History
 * fetcher, the session and the timestamp formatter are stand-ins. Covers the General (`instance`)
 * row, the Team row titles, the shared actor/empty/error/Retry texts, placeholder and acronym
 * preservation and the closed-privacy rule. Translations are machine-prepared; passing this test is
 * not a native-language certification.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance, type ResourceKey } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsHistoryTarget } from "@/fetchers/settings/settings-history";
import { HttpError } from "@/lib/http-error";
import { SettingsHistory as HistoryPanel } from "./settings-history";

// Tests below speak entity/id; the identity comes from the mocked session.
function SettingsHistory({
  type,
  id,
  selector,
}: {
  type: SettingsHistoryTarget;
  id: string;
  userId?: string;
  selector?:
    | { scope: "instance" }
    | { scope: "workspace"; workspaceId: string };
}) {
  return (
    <HistoryPanel
      target={{
        kind: "entity",
        type,
        id,
        scope:
          selector?.scope === "workspace"
            ? { kind: "workspace", workspaceId: selector.workspaceId }
            : { kind: "instance" },
      }}
    />
  );
}

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
      data: { user: { id: "u1" }, session: { id: "s1" } },
    }),
    getSession: async () => ({
      data: { user: { id: "u1" }, session: { id: "s1" } },
      error: null,
    }),
  },
}));
// Identity formatter: the interpolated timestamp is then an exact, locale-independent string.
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));

type Json = Record<string, unknown>;
const I18N_DIR = resolve(process.cwd(), "../../i18n");
const read = (locale: string) =>
  JSON.parse(readFileSync(resolve(I18N_DIR, `${locale}.json`), "utf8")) as Json;
const all = readdirSync(I18N_DIR)
  .filter((file) => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file))
  .map((file) => file.replace(".json", ""));
const nonEnglish = all.filter((locale) => locale !== "en-US");
const english = read("en-US");
const NAMESPACES = ["common", "settings", "workItems", "godModeSettings"];

/** The same word is the natural translation, so equality with English is legitimate here. */
const sameAsEnglish = new Set([
  "de-DE:settings.history.system",
  "pl-PL:settings.history.system",
]);

const at = (source: Json, path: string): string => {
  let node: unknown = source;
  for (const part of path.split(".")) node = (node as Json | undefined)?.[part];
  if (typeof node !== "string") throw new Error(`missing string ${path}`);
  return node;
};

const FIELDS = [
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
  "anonymousRateLimitWindowMinutes", // the API's ...Ms key is shown with this existing label
  "anonymousRateLimitMax",
  "mcpWriteCeilingPerMinute",
  "apiKeyBurstThreshold",
  "timezone",
  "attachmentMaxBytes",
  "attachmentMaxPerItem",
  "attachmentAllowedExtensions",
] as const;
const API_FIELDS = FIELDS.map((f) =>
  f === "anonymousRateLimitWindowMinutes" ? "anonymousRateLimitWindowMs" : f,
);
const HISTORY_KEYS = [
  "title",
  "lastChanged",
  "empty",
  "error",
  "retry",
  "system",
  "apiKey",
  "automation",
  "personUnavailable",
  "entityLabel",
] as const;
const TEAM_ACTIONS = [
  ["team.created", "team_created", "Team created"],
  ["team.updated", "team_updated", "Team settings updated"],
  ["team.member_added", "team_member_added", "Team member added"],
  ["team.member_updated", "team_member_updated", "Team member updated"],
  ["team.member_removed", "team_member_removed", "Team member removed"],
] as const;

/** Representative phrases written out here, independent of the catalog files: [saved, History, team created, time zone]. */
const REPRESENTATIVE: Record<string, [string, string, string, string]> = {
  "en-US": ["Saved", "History", "Team created", "Time zone"],
  "de-DE": ["Gespeichert", "Verlauf", "Team erstellt", "Zeitzone"],
  "el-GR": ["Αποθηκεύτηκε", "Ιστορικό", "Η ομάδα δημιουργήθηκε", "Ζώνη ώρας"],
  "es-ES": ["Guardado", "Historial", "Equipo creado", "Zona horaria"],
  "fr-FR": ["Enregistré", "Historique", "Équipe créée", "Fuseau horaire"],
  "hi-IN": ["सहेजा गया", "इतिहास", "टीम बनाई गई", "समय क्षेत्र"],
  "id-ID": ["Tersimpan", "Riwayat", "Tim dibuat", "Zona waktu"],
  "it-IT": ["Salvato", "Cronologia", "Team creato", "Fuso orario"],
  "ja-JP": ["保存済み", "履歴", "チームを作成", "タイムゾーン"],
  "ko-KR": ["저장됨", "기록", "팀 생성됨", "시간대"],
  "mk-MK": ["Зачувано", "Историја", "Тимот е создаден", "Временска зона"],
  "nl-NL": ["Opgeslagen", "Geschiedenis", "Team aangemaakt", "Tijdzone"],
  "pl-PL": ["Zapisano", "Historia", "Utworzono zespół", "Strefa czasowa"],
  "pt-BR": ["Salvo", "Histórico", "Equipe criada", "Fuso horário"],
  "ru-RU": ["Сохранено", "История", "Команда создана", "Часовой пояс"],
  "tr-TR": ["Kaydedildi", "Geçmiş", "Ekip oluşturuldu", "Saat dilimi"],
  "uk-UA": ["Збережено", "Історія", "Команду створено", "Часовий пояс"],
  "vi-VN": ["Đã lưu", "Lịch sử", "Đã tạo nhóm", "Múi giờ"],
  "zh-CN": ["已保存", "历史记录", "已创建团队", "时区"],
};
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function i18nFor(locale: string) {
  const source = read(locale);
  const instance = createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: locale, // no English fallback: an untranslated key falls to the renderer's defaultValue
    ns: NAMESPACES,
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
      skipOnVariables: true,
      // The app supplies the project term; fixed here so the rendered title is exact.
      defaultVariables: {
        term_project_one: "Project",
        term_project_other: "Projects",
      },
    },
    resources: {
      // Cloned: the instance must never share objects with the module-level catalogs read above.
      [locale]: structuredClone(
        Object.fromEntries(NAMESPACES.map((ns) => [ns, source[ns]])),
      ) as Record<string, ResourceKey>,
    },
  });
  return instance;
}

const when = "2026-01-01T00:00:00Z";
const person = { kind: "person" as const, name: "Alice" };
async function renderHistory(
  locale: string,
  type: SettingsHistoryTarget,
  id: string,
  payload: Json,
) {
  get
    .mockReset()
    .mockResolvedValue({ entityType: type, entityId: id, ...payload });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const instance = await i18nFor(locale);
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={instance}>
        <SettingsHistory type={type} id={id} userId="u1" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}
const open = (locale: string) =>
  fireEvent.click(
    screen.getByRole("button", {
      name: at(read(locale), "settings.history.title"),
    }),
  );
const noPlaceholder = /\{\{|defaultValue|workItems:|settings:history/;

beforeEach(() => get.mockReset());
afterEach(cleanup);

describe("catalog completeness for the History strings (static, real catalogs)", () => {
  it.each(all)(
    "%s: settings actions are complete and absent from work-item actions",
    (locale) => {
      const source = read(locale);
      const settings = ((source.settings as Json).history as Json)
        .actions as Json;
      const workItems = ((source.workItems as Json).auditHistory as Json)
        .actions as Json;
      const expected = ((english.settings as Json).history as Json)
        .actions as Json;
      expect(Object.keys(settings).sort()).toEqual(
        Object.keys(expected).sort(),
      );
      expect(Object.keys(settings)).toHaveLength(74);
      for (const key of Object.keys(expected)) {
        expect(at(source, `settings.history.actions.${key}`)).not.toBe("");
        // `bulk_performed` already had a work-item label ("Bulk change"); the settings panel owns its own.
        if (key !== "bulk_performed") expect(workItems).not.toHaveProperty(key);
      }
      expect(
        at(source, "workItems.auditHistory.actions.work_item_created"),
      ).not.toBe("");
    },
  );

  it.each(nonEnglish)(
    "%s: translated, interpolated, acronym-safe and complete",
    (locale) => {
      const own = read(locale);
      const paths = [
        "common.actions.saved",
        ...HISTORY_KEYS.map((k) => `settings.history.${k}`),
        ...FIELDS.map((f) => `godModeSettings.fields.${f}.label`),
        ...TEAM_ACTIONS.map(([, key]) => `settings.history.actions.${key}`),
      ];
      expect(paths).toHaveLength(34);
      for (const path of paths) {
        const value = at(own, path);
        const base = path.startsWith("settings.history.actions.team_")
          ? TEAM_ACTIONS.find(([, k]) => path.endsWith(k))?.[2]
          : at(english, path);
        expect(value, `${locale} ${path}`).not.toBe("");
        expect(value, `${locale} ${path}`).toBe(value.trim());
        if (!sameAsEnglish.has(`${locale}:${path}`))
          expect(value, `${locale} ${path} is still English`).not.toBe(base);
        expect(
          value.match(/\{\{[^}]+\}\}/g) ?? [],
          `${locale} ${path} placeholders`,
        ).toEqual(base?.match(/\{\{[^}]+\}\}/g) ?? []);
        for (const acronym of ["API", "MCP", "CSP"])
          if (base?.includes(acronym))
            expect(value, `${locale} ${path}`).toContain(acronym);
      }
      // The five team labels are pairwise distinct and none is the generic Saved label.
      const team = TEAM_ACTIONS.map(([, key]) =>
        at(own, `settings.history.actions.${key}`),
      );
      expect(new Set(team).size).toBe(5);
      expect(team).not.toContain(at(own, "common.actions.saved"));
    },
  );

  it("en-US keeps its strings and gains exactly the five Team labels", () => {
    for (const [, key, text] of TEAM_ACTIONS)
      expect(at(english, `settings.history.actions.${key}`)).toBe(text);
    expect(at(english, "common.actions.saved")).toBe("Saved");
  });
});

/** Independent language-review corrections, pinned as exact phrases (placeholders retained). */
const REVIEWED_WORDING: Array<[string, string, string]> = [
  ["ko-KR", "settings.history.lastChanged", "마지막 변경: {{actor}}, {{at}}"],
  ["ko-KR", "settings.history.personUnavailable", "표시할 수 없는 사용자"],
  ["ja-JP", "settings.history.personUnavailable", "表示できないユーザー"],
  [
    "ko-KR",
    "godModeSettings.fields.reopenWindowDays.label",
    "다시 열기 가능 기간(일)",
  ],
  ["pl-PL", "settings.history.empty", "Brak zarejestrowanych zmian."],
  [
    "es-ES",
    "settings.history.actions.team_member_removed",
    "Miembro retirado del equipo",
  ],
  [
    "id-ID",
    "settings.history.actions.team_member_removed",
    "Anggota dikeluarkan dari tim",
  ],
  [
    "vi-VN",
    "settings.history.actions.team_member_removed",
    "Đã gỡ thành viên khỏi nhóm",
  ],
];

describe("reviewed wording corrections", () => {
  it.each(REVIEWED_WORDING)("%s %s", (locale, path, expected) => {
    expect(at(read(locale), path)).toBe(expected);
  });
});

describe("SettingsHistory renders the translated strings (real i18next)", () => {
  it.each(all)("%s: General row, summary and fields", async (locale) => {
    const own = read(locale);
    await renderHistory(locale, "instance", "singleton", {
      lastChanged: { actor: person, at: when },
      rows: [
        {
          at: when,
          actor: person,
          action: "instance.settings_changed",
          changedFields: [...API_FIELDS, "secret_raw"],
          after: { timezone: "hidden-value" },
        },
      ],
    });
    const summary = await screen.findByText(
      at(own, "settings.history.lastChanged")
        .replace("{{actor}}", "Alice")
        .replace("{{at}}", when),
    );
    expect(summary.textContent).not.toMatch(noPlaceholder);
    const [saved, historyTitle, , zone] = REPRESENTATIVE[locale] ?? [];
    // Representative phrases are written out in this file, not read back from the catalog under test.
    expect(at(own, "settings.history.title")).toBe(historyTitle);
    expect(at(own, "common.actions.saved")).toBe(saved);
    open(locale);
    // Row title: the dedicated instance label, never the generic Saved label or the English fallback.
    const instanceTitle = at(
      own,
      "settings.history.actions.instance_settings_changed",
    );
    expect(
      await screen.findByText(new RegExp(`^${escapeRe(instanceTitle)} · `)),
    ).toBeTruthy();
    expect(instanceTitle).not.toBe(saved);
    expect(screen.getByText(new RegExp(escapeRe(zone ?? "")))).toBeTruthy();
    // The 18 labels, in the closed order (each equal to the General form label), then the generic
    // label for the unmapped marker.
    expect(
      screen.getByText(
        [
          ...FIELDS.map((f) => at(own, `godModeSettings.fields.${f}.label`)),
          at(own, "settings.history.fields.unknown"),
        ].join(", "),
      ),
    ).toBeTruthy();
    // Unknown field names, values and raw keys are never shown.
    expect(
      screen.queryByText(/secret_raw|hidden-value|approvalDefaultExpiryDays/),
    ).toBeNull();
  });

  it("falls back to the existing work-item action label and the localized generic label for unknown actions", async () => {
    await renderHistory("en-US", "workspace", "w1", {
      lastChanged: null,
      rows: ["work_item.created", "unknown.action"].map((action) => ({
        at: when,
        actor: person,
        action,
        changedFields: [],
      })),
    });
    open("en-US");
    expect(await screen.findByText(/^Created · /)).toBeTruthy();
    expect(screen.getByText(/^Settings changed · /)).toBeTruthy();
    expect(screen.queryByText(/unknown/i)).toBeNull();
  });

  it.each(all)(
    "%s: five Team action titles, truthfully distinct",
    async (locale) => {
      const own = read(locale);
      await renderHistory(locale, "team", "t1", {
        lastChanged: { actor: person, at: when },
        rows: TEAM_ACTIONS.map(([action], index) => ({
          at: `2026-01-0${index + 1}T00:00:00Z`,
          actor: person,
          action,
          changedFields: [],
        })),
      });
      await screen.findByRole("button", {
        name: at(own, "settings.history.title"),
      });
      open(locale);
      const titles = TEAM_ACTIONS.map(([, key]) =>
        at(own, `settings.history.actions.${key}`),
      );
      for (const title of titles)
        expect(
          await screen.findByText(new RegExp(`^${escapeRe(title)} · `)),
        ).toBeTruthy();
      expect(new Set(titles).size).toBe(5);
      expect(titles[0]).toBe(REPRESENTATIVE[locale]?.[2]);
      expect(
        screen.queryByText(
          new RegExp(`^${escapeRe(at(own, "common.actions.saved"))} · `),
        ),
      ).toBeNull();
    },
  );

  it.each(nonEnglish)(
    "%s: actor labels, empty and error states are translated",
    async (locale) => {
      const own = read(locale);
      for (const [kind, key] of [
        ["system", "system"],
        ["api_key", "apiKey"],
        ["automation", "automation"],
        ["person", "personUnavailable"],
      ] as const) {
        await renderHistory(locale, "instance", "singleton", {
          lastChanged: { actor: { kind, name: null }, at: when },
          rows: [],
        });
        const line = await screen.findByText(
          at(own, "settings.history.lastChanged")
            .replace("{{actor}}", at(own, `settings.history.${key}`))
            .replace("{{at}}", when),
        );
        // Never the English sentence (its actor word alone may legitimately match, e.g. de/pl System).
        expect(line.textContent).not.toContain("Last changed by");
        cleanup();
      }
      await renderHistory(locale, "instance", "singleton", {
        lastChanged: null,
        rows: [],
      });
      expect(
        await screen.findByText(at(own, "settings.history.empty")),
      ).toBeTruthy();
      expect(screen.queryByText("No recorded changes yet.")).toBeNull();
      cleanup();
      get.mockReset().mockRejectedValueOnce(new HttpError(500, "boom"));
      const instance = await i18nFor(locale);
      render(
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <I18nextProvider i18n={instance}>
            <SettingsHistory type="instance" id="singleton" userId="u1" />
          </I18nextProvider>
        </QueryClientProvider>,
      );
      expect(
        await screen.findByText(at(own, "settings.history.error")),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: at(own, "settings.history.retry") }),
      ).toBeTruthy();
      expect(screen.queryByText("Could not load history.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    },
  );
});

const NEW_FIELDS = [
  "name",
  "description",
  "icon",
  "key",
  "logo",
  "workspaceSlug",
  "kind",
  "supportLevel",
  "serviceCalendar",
  "defaultSlaPolicy",
  "defaultServiceCalendar",
  "slaPolicy",
  "defaultCommentVisibility",
  "manager",
  "startDate",
  "endDate",
  "defaultAssignee",
  "health",
  "stateSetMode",
  "position",
  "isDefault",
  "activity",
  "archived",
  "workflowDefinition",
  "workflowActiveVersion",
  "backdateLimit",
  "defaultBillable",
] as const;
const NEW_ACTIONS = [
  "workspace_settings_updated",
  "workspace_project_settings_updated",
  "project_settings_updated",
  "project_general_settings_updated",
  "project_states_updated",
  "time_activity_created",
  "time_activity_updated",
] as const;

describe("workspace, project and time activity History labels", () => {
  it.each(nonEnglish)(
    "%s: every label key exists with its placeholders",
    (locale) => {
      const own = read(locale);
      const paths = [
        ...NEW_FIELDS.map((k) => `settings.history.fields.${k}`),
        ...NEW_ACTIONS.map((k) => `settings.history.actions.${k}`),
      ];
      for (const path of paths) {
        const value = at(own, path);
        expect(value, `${locale} ${path}`).toBe(value.trim());
        expect(value, `${locale} ${path}`).not.toBe("");
        // Some catalogs spell the project word out instead of using the term placeholder.
        for (const placeholder of value.match(/\{\{[^}]+\}\}/g) ?? [])
          expect(
            ["{{term_project_one}}", "{{term_project_other}}"],
            `${locale} ${path}`,
          ).toContain(placeholder);
      }
    },
  );

  it.each([
    [
      "en-US",
      "workspace",
      "workspace.project_settings_updated",
      ["defaultSlaPolicyId", "defaultServiceCalendarId"],
      "Default SLA policy, Default service calendar",
    ],
    [
      "de-DE",
      "workspace",
      "workspace.project_settings_updated",
      ["defaultSlaPolicyId", "defaultServiceCalendarId"],
      "Standard-SLA-Richtlinie, Standard-Servicekalender",
    ],
    [
      "en-US",
      "project",
      "project.settings_updated",
      ["slaPolicy", "serviceCalendar"],
      "SLA policy, Service calendar",
    ],
    [
      "de-DE",
      "project",
      "project.settings_updated",
      ["slaPolicy", "serviceCalendar"],
      "SLA-Richtlinie, Servicekalender",
    ],
  ] as const)(
    "%s renders %s inheritance fields",
    async (locale, type, action, changedFields, labels) => {
      await renderHistory(locale, type, "x1", {
        lastChanged: { actor: person, at: when },
        rows: [{ at: when, actor: person, action, changedFields }],
      });
      await screen.findByRole("button", {
        name: at(read(locale), "settings.history.title"),
      });
      open(locale);
      expect(await screen.findByText(labels)).toBeTruthy();
    },
  );

  it("de-DE: workspace update, project field change and time activity events are German", async () => {
    const own = read("de-DE");
    const cases: Array<
      [
        "workspace" | "project" | "time_activity",
        string,
        string[],
        string,
        string,
      ]
    > = [
      [
        "workspace",
        "workspace.settings_updated",
        ["name", "description"],
        "Workspace-Einstellungen aktualisiert",
        "Name, Beschreibung",
      ],
      [
        "project",
        "project.general_settings_updated",
        ["serviceCalendarId", "managerId"],
        "Allgemeine Projekteinstellungen aktualisiert",
        "Servicekalender, Projektleitung",
      ],
      [
        "time_activity",
        "time_activity.created",
        ["name"],
        "Zeitaktivität erstellt",
        "Aktivität",
      ],
      [
        "time_activity",
        "time_activity.updated",
        ["name", "archived"],
        "Zeitaktivität aktualisiert",
        "Aktivität, Archiviert",
      ],
    ];
    for (const [type, action, changedFields, title, fields] of cases) {
      await renderHistory("de-DE", type, "x1", {
        lastChanged: { actor: person, at: when },
        rows: [{ at: when, actor: person, action, changedFields }],
      });
      await screen.findByRole("button", {
        name: at(own, "settings.history.title"),
      });
      open("de-DE");
      expect(
        await screen.findByText(new RegExp(`^${escapeRe(title)} · `)),
      ).toBeTruthy();
      expect(screen.getByText(fields)).toBeTruthy();
      expect(
        screen.queryByText(
          /Workspace settings|Time activity|Service calendar|Manager|Archived|Activity|settings updated|Description/,
        ),
      ).toBeNull();
      cleanup();
    }
  });
});

type Inventory = Array<{
  type:
    | "workspace"
    | "project"
    | "workflow"
    | "canned_response"
    | "service_calendar"
    | "sla_policy"
    | "request_type"
    | "custom_field"
    | "custom_field_section"
    | "state_template"
    | "team"
    | "time_activity"
    | "instance"
    | "webhook"
    | "instance_auth_methods"
    | "staff_self_registration"
    | "instance_job"
    | "identity_connection"
    | "workspace_label"
    | "project_label"
    | "state"
    | "cost_type"
    | "hourly_rate"
    | "budget";
  action: string;
  /** [API marker, settings.history.fields key]; written out here, independent of the renderer. */
  fields: Array<[string, string]>;
}>;
const same = (names: string[]): Array<[string, string]> =>
  names.map((n) => [n, n]);
const INSTANCE_FIELDS = same(API_FIELDS);
const CANNED_FIELDS = same(["name", "body", "visibilityDefault"]);
const LABEL_FIELDS = same(["name", "color"]);
const labelRows = (type: "workspace_label" | "project_label") =>
  ["created", "updated", "deleted"].map((verb) => ({
    type,
    action: `label.catalogue_${verb}`,
    fields: LABEL_FIELDS,
  }));
/** Every action and marker the settings History panel can show (API: HISTORY_FIELDS, entityHistoryRow, producers). */
const INVENTORY: Inventory = [
  { type: "workspace", action: "workspace.created", fields: [] },
  {
    type: "workspace",
    action: "workspace.settings_updated",
    fields: [
      ["name", "name"],
      ["slug", "workspaceSlug"],
      ["logo", "logo"],
      ["description", "description"],
    ],
  },
  {
    type: "workspace",
    action: "workspace.project_settings_updated",
    fields: [
      ["defaultSlaPolicyId", "defaultSlaPolicy"],
      ["defaultServiceCalendarId", "defaultServiceCalendar"],
    ],
  },
  {
    type: "workspace",
    action: "time_settings.updated",
    fields: [["backdateLimitDays", "backdateLimit"]],
  },
  { type: "workspace", action: "kb.settings_changed", fields: [] },
  { type: "workspace", action: "bulk.performed", fields: [] },
  { type: "project", action: "project.created", fields: [] },
  { type: "project", action: "project.archived", fields: [] },
  { type: "project", action: "project.restored", fields: [] },
  { type: "project", action: "project.summary_updated", fields: [] },
  {
    type: "project",
    action: "project.customer_organisation_linked",
    fields: [],
  },
  { type: "project", action: "project.reach_changed", fields: [] },
  { type: "project", action: "agile.settings_updated", fields: [] },
  {
    type: "project",
    action: "project.settings_updated",
    fields: [
      ["slaPolicy", "slaPolicy"],
      ["serviceCalendar", "serviceCalendar"],
      ["stateSetMode", "stateSetMode"],
    ],
  },
  {
    type: "project",
    action: "project.general_settings_updated",
    fields: [
      ["name", "name"],
      ["icon", "icon"],
      ["slug", "key"],
      ["description", "description"],
      ["kind", "kind"],
      ["supportLevel", "supportLevel"],
      ["serviceCalendarId", "serviceCalendar"],
      ["defaultCommentVisibility", "defaultCommentVisibility"],
      ["managerId", "manager"],
      ["startDate", "startDate"],
      ["endDate", "endDate"],
      ["defaultAssigneeId", "defaultAssignee"],
      ["health", "health"],
    ],
  },
  {
    type: "project",
    action: "project.states_updated",
    fields: [
      ["stateSetMode", "stateSetMode"],
      ["position", "position"],
      ["isDefault", "isDefault"],
    ],
  },
  {
    type: "project",
    action: "time_settings.updated",
    fields: [["projectDefaultBillable", "defaultBillable"]],
  },
  {
    type: "workflow",
    action: "workflow.created",
    fields: [["definition", "workflowDefinition"]],
  },
  {
    type: "workflow",
    action: "workflow.version_created",
    fields: [["definition", "workflowDefinition"]],
  },
  {
    type: "workflow",
    action: "workflow.version_published",
    fields: [["activeVersion", "workflowActiveVersion"]],
  },
  { type: "workflow", action: "workflow.cab_template_applied", fields: [] },
  {
    type: "canned_response",
    action: "canned_response.created",
    fields: CANNED_FIELDS,
  },
  {
    type: "canned_response",
    action: "canned_response.updated",
    fields: CANNED_FIELDS,
  },
  {
    type: "canned_response",
    action: "canned_response.deleted",
    fields: CANNED_FIELDS,
  },
  {
    type: "time_activity",
    action: "time_activity.created",
    fields: [["name", "activity"]],
  },
  {
    type: "time_activity",
    action: "time_activity.updated",
    fields: [
      ["name", "activity"],
      ["archived", "archived"],
    ],
  },
  { type: "team", action: "team.deleted", fields: [] },
  { type: "service_calendar", action: "service_calendar.created", fields: [] },
  { type: "service_calendar", action: "service_calendar.updated", fields: [] },
  { type: "service_calendar", action: "service_calendar.deleted", fields: [] },
  { type: "sla_policy", action: "sla_policy.created", fields: [] },
  { type: "sla_policy", action: "sla_policy.updated", fields: [] },
  { type: "sla_policy", action: "sla_policy.published", fields: [] },
  { type: "request_type", action: "request_type.created", fields: [] },
  { type: "request_type", action: "request_type.updated", fields: [] },
  { type: "request_type", action: "request_type.published", fields: [] },
  { type: "request_type", action: "request_type.unpublished", fields: [] },
  { type: "request_type", action: "request_type.deleted", fields: [] },
  { type: "custom_field", action: "custom_field.created", fields: [] },
  { type: "custom_field", action: "custom_field.updated", fields: [] },
  { type: "custom_field", action: "custom_field.deleted", fields: [] },
  { type: "custom_field", action: "custom_field.restored", fields: [] },
  { type: "custom_field", action: "custom_field.purged", fields: [] },
  {
    type: "custom_field_section",
    action: "custom_field_section.created",
    fields: [],
  },
  {
    type: "custom_field_section",
    action: "custom_field_section.updated",
    fields: [],
  },
  {
    type: "custom_field_section",
    action: "custom_field_section.deleted",
    fields: [],
  },
  {
    type: "state_template",
    action: "state_template.created",
    fields: [
      ["created", "created"],
      ["enabled", "enabled"],
    ],
  },
  {
    type: "state_template",
    action: "state_template.updated",
    fields: [
      ["name", "name"],
      ["group", "group"],
      ["enabled", "enabled"],
    ],
  },
  {
    type: "instance",
    action: "instance.settings_changed",
    fields: INSTANCE_FIELDS,
  },
  { type: "webhook", action: "webhook.created", fields: [] },
  { type: "webhook", action: "webhook.updated", fields: [] },
  { type: "webhook", action: "webhook.deleted", fields: [] },
  { type: "webhook", action: "webhook.secret_rotated", fields: [] },
  { type: "webhook", action: "webhook.auto_disabled", fields: [] },
  {
    type: "instance_auth_methods",
    action: "plugin.changed",
    fields: [
      ["agent.password", "authAgentPassword"],
      ["agent.magicLink", "authAgentMagicLink"],
      ["agent.emailOtp", "authAgentEmailOtp"],
      ["customer.password", "authCustomerPassword"],
      ["customer.magicLink", "authCustomerMagicLink"],
      ["customer.emailOtp", "authCustomerEmailOtp"],
    ],
  },
  {
    type: "staff_self_registration",
    action: "plugin.changed",
    fields: [["enabled", "staffSelfRegistration"]],
  },
  {
    type: "instance_job",
    action: "job.configuration_changed",
    fields: [
      ["pattern", "schedule"],
      ["enabled", "enabled"],
    ],
  },
  {
    type: "identity_connection",
    action: "identity_connection.changed",
    fields: [],
  },
];
const actionKey = (action: string) =>
  `settings.history.actions.${action.replace(/\./g, "_")}`;
const INVENTORY_ACTIONS = [...new Set(INVENTORY.map((e) => e.action))];
const INVENTORY_FIELD_KEYS = [
  ...new Set(INVENTORY.flatMap((e) => e.fields.map(([, key]) => key))),
];
const GENERIC = [
  "settings.history.actions.unknown",
  "settings.history.fields.unknown",
];
/** Same word is the natural translation (loan words, acronyms, units). */
const labelSameAsEnglish = new Set<string>([
  "de-DE:settings.history.fields.name",
  "de-DE:settings.history.fields.logo",
  "de-DE:settings.history.fields.position",
  "es-ES:settings.history.fields.color",
  "fr-FR:settings.history.fields.description",
  "fr-FR:settings.history.fields.logo",
  "fr-FR:settings.history.fields.position",
  "fr-FR:settings.history.fields.workflowDefinition",
  "id-ID:settings.history.fields.logo",
  "id-ID:settings.history.fields.isDefault",
  "it-IT:settings.history.fields.logo",
  "nl-NL:settings.history.fields.logo",
  "nl-NL:settings.history.fields.manager",
  "pl-PL:settings.history.fields.logo",
  "tr-TR:settings.history.fields.logo",
  "vi-VN:settings.history.fields.logo",
]);

describe("full History inventory has dedicated localized labels", () => {
  it("covers every action and field of the API projection", () => {
    expect(INVENTORY_ACTIONS).toHaveLength(56);
    expect(new Set(INVENTORY_ACTIONS.map(actionKey)).size).toBe(56);
  });

  it.each(all)(
    "%s: every inventory and generic key exists, is translated and keeps placeholders",
    (locale) => {
      const own = read(locale);
      const keys = [
        ...INVENTORY_ACTIONS.map(actionKey),
        ...INVENTORY_FIELD_KEYS.map((k) => `settings.history.fields.${k}`),
        ...GENERIC,
      ];
      for (const path of keys) {
        const value = at(own, path);
        expect(value, `${locale} ${path}`).toBe(value.trim());
        expect(value, `${locale} ${path}`).not.toBe("");
        const base = at(english, path);
        if (locale !== "en-US" && !labelSameAsEnglish.has(`${locale}:${path}`))
          expect(value, `${locale} ${path} is still English`).not.toBe(base);
        for (const placeholder of value.match(/\{\{[^}]+\}\}/g) ?? [])
          expect(
            ["{{term_project_one}}", "{{term_project_other}}"],
            `${locale} ${path}`,
          ).toContain(placeholder);
      }
      // The generic labels must not collapse into a specific one.
      const actions = INVENTORY_ACTIONS.map((a) => at(own, actionKey(a)));
      expect(new Set(actions).size).toBe(actions.length);
      expect(actions).not.toContain(at(own, GENERIC[0] as string));
    },
  );

  it.each(["en-US", "de-DE"])(
    "%s: each inventory row renders its dedicated action and field labels",
    async (locale) => {
      const own = read(locale);
      const vars = {
        term_project_one: "Project",
        term_project_other: "Projects",
      };
      const fill = (text: string) =>
        text.replace(
          /\{\{(\w+)\}\}/g,
          (_m, name: string) => vars[name as keyof typeof vars] ?? "",
        );
      for (const { type, action, fields } of INVENTORY) {
        await renderHistory(locale, type, "x1", {
          lastChanged: { actor: person, at: when },
          rows: [
            {
              at: when,
              actor: person,
              action,
              changedFields: fields.map(([marker]) => marker),
            },
          ],
        });
        await screen.findByRole("button", {
          name: at(own, "settings.history.title"),
        });
        open(locale);
        const title = fill(at(own, actionKey(action)));
        const row = (
          await screen.findByText(new RegExp(`^${escapeRe(title)} · `))
        ).closest("div") as HTMLElement;
        expect(row.textContent, `${type} ${action}`).not.toMatch(
          /settings:history|workItems:|\w+\.\w+_\w+/,
        );
        expect(row.textContent).not.toContain(
          `${fill(at(own, GENERIC[0] as string))} · `,
        );
        if (fields.length > 0) {
          const labels = [
            ...new Set(
              fields.map(([, key]) =>
                at(own, `settings.history.fields.${key}`),
              ),
            ),
          ];
          expect(
            screen.getByText(labels.join(", ")),
            `${type} ${action} fields`,
          ).toBeTruthy();
          expect(row.textContent).not.toContain(at(own, GENERIC[1] as string));
        } else {
          expect(row.querySelectorAll("p")).toHaveLength(1);
        }
        cleanup();
      }
    },
  );

  it.each(all)(
    "%s: an unknown action and unknown field render the localized generic labels, never raw keys",
    async (locale) => {
      const own = read(locale);
      await renderHistory(locale, "workspace", "w9", {
        lastChanged: { actor: person, at: when },
        rows: [
          {
            at: when,
            actor: person,
            action: "brand_new.thing_happened",
            changedFields: ["brandNewField", "anotherNewField"],
          },
        ],
      });
      await screen.findByRole("button", {
        name: at(own, "settings.history.title"),
      });
      open(locale);
      const generic = at(own, GENERIC[0] as string);
      expect(
        await screen.findByText(new RegExp(`^${escapeRe(generic)} · `)),
      ).toBeTruthy();
      // Both unmapped markers collapse into one generic field label.
      expect(screen.getByText(at(own, GENERIC[1] as string))).toBeTruthy();
      expect(
        screen.queryByText(
          /brand_new|thing_happened|brandNewField|anotherNewField|Brand new/i,
        ),
      ).toBeNull();
    },
  );
});

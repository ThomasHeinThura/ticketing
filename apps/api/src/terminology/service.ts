import { createHash } from "node:crypto";
import {
  type JsonValue,
  SHIPPED_TERMINOLOGY,
  TERMINOLOGY_LOCALES,
  TERMINOLOGY_TERM_KEYS,
  type TerminologyAudience,
  type TerminologyForms,
  type TerminologyOverride,
  type TerminologyTermKey,
} from "@taskdesk/domain";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";

const overrideTable = schema.terminologyOverrideTable;
type AppLocale = (typeof TERMINOLOGY_LOCALES)[number];
type TerminologyOverrideDto = Omit<TerminologyOverride, "locale"> & {
  locale: AppLocale;
};

const terminologyAudiences = ["agent", "customer", "both"] as const;
const terminologyScopes = ["instance", "workspace"] as const;

export const terminologyLocales = TERMINOLOGY_LOCALES;

export function requireTerminologyLocale(value: string): AppLocale {
  if (!(TERMINOLOGY_LOCALES as readonly string[]).includes(value))
    throw new TypeError("Unsupported locale");
  return value as AppLocale;
}

function requireAllowedValue<const Values extends readonly string[]>(
  value: string,
  allowed: Values,
  name: string,
): Values[number] {
  if (!(allowed as readonly string[]).includes(value))
    throw new TypeError(`Unsupported terminology ${name}`);
  return value as Values[number];
}

function parseOverrideRow(row: {
  scope: string;
  workspaceId: string | null;
  audience: string;
  termKey: string;
  locale: string;
  forms: Record<string, string>;
}): TerminologyOverrideDto {
  return {
    scope: requireAllowedValue(row.scope, terminologyScopes, "scope"),
    workspaceId: row.workspaceId,
    audience: requireAllowedValue(
      row.audience,
      terminologyAudiences,
      "audience",
    ),
    termKey: requireAllowedValue(
      row.termKey,
      TERMINOLOGY_TERM_KEYS,
      "term key",
    ),
    locale: requireTerminologyLocale(row.locale),
    forms: row.forms,
  };
}

function formsForAudience(
  locale: AppLocale,
  audience: Exclude<TerminologyAudience, "both">,
  termKey: TerminologyTermKey,
): TerminologyForms {
  const values = SHIPPED_TERMINOLOGY[locale][audience] as Record<
    string,
    string
  >;
  const categories = new Intl.PluralRules(locale).resolvedOptions()
    .pluralCategories;
  const forms: Record<string, string> = {};
  for (const category of categories) {
    const value = values[`${termKey}_${category}`];
    if (typeof value !== "string" || !value.trim())
      throw new TypeError(`The locale is missing ${termKey}_${category}`);
    forms[category] = value;
  }
  return forms;
}

export type EffectiveTerminology = Record<TerminologyTermKey, TerminologyForms>;

function emptyEffectiveTerminology(): EffectiveTerminology {
  return Object.fromEntries(
    TERMINOLOGY_TERM_KEYS.map((key) => [key, {}]),
  ) as EffectiveTerminology;
}

function rowForms(
  rows: readonly (typeof overrideTable.$inferSelect)[],
  workspaceId: string | null,
  audience: Exclude<TerminologyAudience, "both">,
  key: TerminologyTermKey,
): TerminologyForms | null {
  const scopes = workspaceId ? ["workspace", "instance"] : ["instance"];
  for (const scope of scopes) {
    const candidates = rows.filter(
      (row) =>
        row.termKey === key &&
        row.scope === scope &&
        (scope === "workspace" ? row.workspaceId === workspaceId : true),
    );
    const exact = candidates.find((row) => row.audience === audience);
    const shared = candidates.find((row) => row.audience === "both");
    const selected = exact ?? shared;
    if (selected) return selected.forms;
  }
  return null;
}

export async function resolveEffectiveTerminology(input: {
  locale: string;
  audience: Exclude<TerminologyAudience, "both">;
  workspaceId?: string | null;
  executor?: Executor;
}): Promise<EffectiveTerminology> {
  const locale = requireTerminologyLocale(input.locale);
  const workspaceId = input.workspaceId ?? null;
  const executor = input.executor ?? db;
  const rows = await executor
    .select()
    .from(overrideTable)
    .where(
      and(
        eq(overrideTable.locale, locale),
        inArray(overrideTable.audience, [input.audience, "both"]),
        workspaceId
          ? or(
              and(
                eq(overrideTable.scope, "workspace"),
                eq(overrideTable.workspaceId, workspaceId),
              ),
              and(
                eq(overrideTable.scope, "instance"),
                // Instance overrides have a null workspace id.
                isNull(overrideTable.workspaceId),
              ),
            )
          : and(
              eq(overrideTable.scope, "instance"),
              isNull(overrideTable.workspaceId),
            ),
      ),
    );
  const result = emptyEffectiveTerminology();
  for (const termKey of TERMINOLOGY_TERM_KEYS) {
    result[termKey] =
      rowForms(rows, workspaceId, input.audience, termKey) ??
      formsForAudience(locale, input.audience, termKey);
  }
  return result;
}

export async function resolveTermForm(input: {
  locale: string;
  audience: Exclude<TerminologyAudience, "both">;
  termKey: TerminologyTermKey;
  count: number;
  workspaceId?: string | null;
  executor?: Executor;
}): Promise<string> {
  const locale = requireTerminologyLocale(input.locale);
  if (!Number.isSafeInteger(input.count) || input.count < 0)
    throw new TypeError("Terminology count must be a nonnegative safe integer");
  const effective = await resolveEffectiveTerminology(input);
  const category = new Intl.PluralRules(locale).select(input.count);
  const form =
    effective[input.termKey][category] ?? effective[input.termKey].other;
  if (!form) throw new TypeError("The terminology form is unavailable");
  return form;
}

export async function getInstanceTerminologyOverrides(input: {
  locale: string;
  audience: Exclude<TerminologyAudience, "both">;
  executor?: Executor;
}) {
  const locale = requireTerminologyLocale(input.locale);
  const executor = input.executor ?? db;
  const rows = await executor
    .select({
      audience: overrideTable.audience,
      termKey: overrideTable.termKey,
      forms: overrideTable.forms,
    })
    .from(overrideTable)
    .where(
      and(
        eq(overrideTable.scope, "instance"),
        eq(overrideTable.locale, locale),
        inArray(overrideTable.audience, [input.audience, "both"]),
        isNull(overrideTable.workspaceId),
      ),
    );
  const terms: Partial<Record<TerminologyTermKey, TerminologyForms>> = {};
  for (const key of TERMINOLOGY_TERM_KEYS) {
    const exact = rows.find(
      (row) => row.termKey === key && row.audience === input.audience,
    );
    const shared = rows.find(
      (row) => row.termKey === key && row.audience === "both",
    );
    const selected = exact ?? shared;
    if (selected) terms[key] = selected.forms;
  }
  const stableValue = JSON.stringify({
    locale,
    audience: input.audience,
    terms,
  });
  const etag = `"${createHash("sha256").update(stableValue).digest("hex")}"`;
  return { locale, audience: input.audience, terms, etag };
}

export function effectiveTerminologyEtag(input: {
  locale: string;
  audience: Exclude<TerminologyAudience, "both">;
  workspaceId: string;
  terms: EffectiveTerminology;
}) {
  const terms = Object.fromEntries(
    TERMINOLOGY_TERM_KEYS.map((key) => [
      key,
      Object.fromEntries(
        Object.entries(input.terms[key]).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ]),
  );
  const canonical = JSON.stringify({
    locale: input.locale,
    audience: input.audience,
    workspaceId: input.workspaceId,
    terms,
  });
  return `"${createHash("sha256").update(canonical).digest("hex")}"`;
}

export async function listTerminologyOverrides(input: {
  scope: "instance" | "workspace";
  workspaceId?: string | null;
}): Promise<TerminologyOverrideDto[]> {
  const rows = await db
    .select({
      scope: overrideTable.scope,
      workspaceId: overrideTable.workspaceId,
      audience: overrideTable.audience,
      termKey: overrideTable.termKey,
      locale: overrideTable.locale,
      forms: overrideTable.forms,
    })
    .from(overrideTable)
    .where(
      input.scope === "instance"
        ? and(
            eq(overrideTable.scope, "instance"),
            isNull(overrideTable.workspaceId),
          )
        : and(
            eq(overrideTable.scope, "workspace"),
            eq(overrideTable.workspaceId, input.workspaceId ?? ""),
          ),
    );
  return rows.map(parseOverrideRow);
}

function canonicalOverrides(rows: readonly TerminologyOverride[]) {
  return [...rows].sort((left, right) =>
    [
      left.locale,
      left.audience,
      left.termKey,
      left.scope,
      left.workspaceId ?? "",
    ]
      .join("\u0000")
      .localeCompare(
        [
          right.locale,
          right.audience,
          right.termKey,
          right.scope,
          right.workspaceId ?? "",
        ].join("\u0000"),
      ),
  );
}

export function terminologyEtag(rows: readonly TerminologyOverride[]) {
  const canonical = canonicalOverrides(rows).map((row) => ({
    scope: row.scope,
    workspaceId: row.workspaceId,
    audience: row.audience,
    termKey: row.termKey,
    locale: row.locale,
    forms: Object.fromEntries(
      Object.entries(row.forms).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  }));
  return `"${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}"`;
}

export class TerminologyConflictError extends Error {
  constructor(readonly currentEtag: string) {
    super("version_conflict");
  }
}

export type TerminologyActor = {
  userId: string;
  personId: string;
  traceId?: string | null;
};

export type SaveTerminologyOverride = {
  scope: "instance" | "workspace";
  workspaceId: string | null;
  audience: TerminologyAudience;
  termKey: TerminologyTermKey;
  locale: string;
  forms: TerminologyForms | null;
  expectedEtag: string;
};

function validateTerminologyForms(locale: AppLocale, forms: TerminologyForms) {
  if (!forms || typeof forms !== "object" || Array.isArray(forms))
    throw new TypeError("forms must be an object");
  const categories = new Intl.PluralRules(locale).resolvedOptions()
    .pluralCategories;
  const keys = Object.keys(forms).sort();
  const expected = [...categories].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  )
    throw new TypeError("forms must match this locale's CLDR categories");
  for (const value of Object.values(forms)) {
    if (typeof value !== "string" || !value.trim() || value.includes("\u0000"))
      throw new TypeError("Each plural form must be nonempty text");
  }
  if (Buffer.byteLength(JSON.stringify(forms), "utf8") > 8192)
    throw new TypeError("The terminology forms exceed the storage limit");
}

async function listWithinTransaction(
  executor: Executor,
  scope: "instance" | "workspace",
  workspaceId: string | null,
): Promise<TerminologyOverrideDto[]> {
  const rows = await executor
    .select({
      scope: overrideTable.scope,
      workspaceId: overrideTable.workspaceId,
      audience: overrideTable.audience,
      termKey: overrideTable.termKey,
      locale: overrideTable.locale,
      forms: overrideTable.forms,
    })
    .from(overrideTable)
    .where(
      scope === "instance"
        ? and(
            eq(overrideTable.scope, "instance"),
            isNull(overrideTable.workspaceId),
          )
        : and(
            eq(overrideTable.scope, "workspace"),
            eq(overrideTable.workspaceId, workspaceId ?? ""),
          ),
    );
  return rows.map(parseOverrideRow);
}

function auditJson(override: TerminologyOverride | null): JsonValue | null {
  if (!override) return null;
  return {
    scope: override.scope,
    workspaceId: override.workspaceId,
    audience: override.audience,
    termKey: override.termKey,
    locale: override.locale,
    forms: override.forms as JsonValue,
  };
}

export async function saveTerminologyOverride(
  input: SaveTerminologyOverride,
  actor: TerminologyActor,
): Promise<{ overrides: TerminologyOverrideDto[]; etag: string }> {
  const locale = requireTerminologyLocale(input.locale);
  if (
    (input.scope === "instance" && input.workspaceId !== null) ||
    (input.scope === "workspace" && !input.workspaceId)
  )
    throw new TypeError("The terminology scope does not match its workspace");
  if (input.forms) validateTerminologyForms(locale, input.forms);

  return db.transaction(async (tx) => {
    const lockKey = `terminology:${input.scope}:${input.workspaceId ?? "instance"}`;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
    const beforeRows = await listWithinTransaction(
      tx,
      input.scope,
      input.workspaceId,
    );
    if (terminologyEtag(beforeRows) !== input.expectedEtag)
      throw new TerminologyConflictError(terminologyEtag(beforeRows));

    const existing =
      beforeRows.find(
        (row) =>
          row.audience === input.audience &&
          row.termKey === input.termKey &&
          row.locale === locale,
      ) ?? null;
    const target = and(
      eq(overrideTable.scope, input.scope),
      input.workspaceId
        ? eq(overrideTable.workspaceId, input.workspaceId)
        : isNull(overrideTable.workspaceId),
      eq(overrideTable.audience, input.audience),
      eq(overrideTable.termKey, input.termKey),
      eq(overrideTable.locale, locale),
    );
    await tx.delete(overrideTable).where(target);
    if (input.forms) {
      await tx.insert(overrideTable).values({
        scope: input.scope,
        workspaceId: input.workspaceId,
        audience: input.audience,
        termKey: input.termKey,
        locale,
        forms: input.forms,
      });
    }
    const after = input.forms
      ? {
          scope: input.scope,
          workspaceId: input.workspaceId,
          audience: input.audience,
          termKey: input.termKey,
          locale,
          forms: input.forms,
        }
      : null;
    await appendAuditLog(tx, {
      actorId: actor.userId,
      actorType: "person",
      traceId: actor.traceId ?? null,
      workspaceId: input.workspaceId,
      action: "terminology.changed",
      entityType: "terminology_override",
      entityId: `${input.termKey}:${input.audience}:${locale}`,
      before: auditJson(existing),
      after: auditJson(after),
    });
    const overrides = await listWithinTransaction(
      tx,
      input.scope,
      input.workspaceId,
    );
    return { overrides, etag: terminologyEtag(overrides) };
  });
}

/**
 * TaskDesk import bundle, version 1: a newline-delimited JSON file (one object per line) that any
 * converter (the first is `scripts/import/plane-to-bundle.mjs`) writes and the `import.bundle`
 * adapter reads. Pure: no I/O. It lives here because `packages/domain` may not depend on zod
 * (`check:deps`). `packages/mcp/src/utils/import-bundle-schema.ts` is a byte copy of this file (the
 * MCP package is published and cannot depend on the API); a test keeps them identical, so edit
 * this file and copy it.
 *
 * Caps equal `apps/api/src/imports/schema.ts` (record schema v2). IDs are source-local strings;
 * `person` lines are the only place emails live, and items refer to people by id.
 */
import { z } from "zod";

export const BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 8_000_000;
export const MAX_BUNDLE_ITEMS = 50_000;
export const BUNDLE_CAPS = {
  commentChars: 100_000,
  comments: 500,
  attachments: 100,
  relations: 200,
  history: 1000,
  links: 100,
} as const;
export const BUNDLE_STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

const opaque = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      }),
    );
const id = opaque(512);
const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !value.includes("\u0000"));
const isoDateTime = z.string().datetime({ offset: true });
const email = z.string().email().max(320);
const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      const credentialLikeQueryKey = [...url.searchParams.keys()].some((key) =>
        /(?:token|secret|password|authorization|api[-_]?key|credential|signature|^sig$)/iu.test(
          key,
        ),
      );
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !credentialLikeQueryKey &&
        !url.hash
      );
    } catch {
      return false;
    }
  });
const noNul = (value: unknown) => !JSON.stringify(value)?.includes("\\u0000");
const commentBody = z.union([
  text(BUNDLE_CAPS.commentChars),
  z
    .object({ type: z.literal("doc") })
    .passthrough()
    .refine(noNul)
    .refine((value) => JSON.stringify(value).length <= 256 * 1024),
]);
const historyValue = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const bundleHeaderLine = z
  .object({
    t: z.literal("header"),
    bundleVersion: z.literal(BUNDLE_VERSION),
    source: z
      .object({
        system: opaque(80),
        version: opaque(80).optional(),
        instance: opaque(200),
        workspace: opaque(200),
        exportedAt: isoDateTime.optional(),
      })
      .strict(),
    /** What the converter could not carry (an unsupported endpoint, a truncated list): never silent. */
    warnings: z
      .array(
        z
          .object({
            code: opaque(64),
            endpoint: opaque(80).optional(),
            item: id.optional(),
            omitted: z.number().int().nonnegative().safe().optional(),
          })
          .strict(),
      )
      .max(5000)
      .optional(),
  })
  .strict();
export const bundlePersonLine = z
  .object({
    t: z.literal("person"),
    id,
    email: email.optional(),
    name: text(200).optional(),
  })
  .strict();
export const bundleProjectLine = z
  .object({
    t: z.literal("project"),
    id,
    key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    name: text(200),
    kind: z.literal("project").optional(),
    url: httpsUrl.optional(),
  })
  .strict();
export const bundleMembershipLine = z
  .object({
    t: z.literal("membership"),
    project: id,
    person: id,
    role: z.enum(["lead", "member", "viewer"]),
    sourceRole: opaque(40).optional(),
  })
  .strict();
export const bundleStateLine = z
  .object({
    t: z.literal("state"),
    project: id,
    id,
    name: text(200),
    group: z.enum(BUNDLE_STATE_GROUPS),
  })
  .strict();
export const bundleLabelLine = z
  .object({
    t: z.literal("label"),
    project: id,
    id,
    name: text(200),
    color: opaque(40).optional(),
  })
  .strict();

const bundleComment = z
  .object({
    id,
    author: id.optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
    visibility: z.enum(["public", "internal"]).optional(),
    body: commentBody,
  })
  .strict();
const bundleAttachment = z
  .object({
    id,
    url: httpsUrl,
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          !value.includes("/") &&
          !value.includes("\\") &&
          [...value].every((c) => (c.codePointAt(0) ?? 0) >= 32),
      ),
    mimeType: z.string().min(1).max(200).optional(),
    size: z.number().int().nonnegative().safe().optional(),
    author: id.optional(),
    createdAt: isoDateTime.optional(),
  })
  .strict();
const bundleRelation = z
  .object({
    type: z.enum(["relates", "blocks", "duplicates", "precedes", "requires"]),
    target: id,
  })
  .strict();
const bundleHistory = z
  .object({
    id,
    at: isoDateTime,
    author: id.optional(),
    field: opaque(120),
    from: historyValue.optional(),
    to: historyValue.optional(),
  })
  .strict();
const bundleLink = z
  .object({ url: httpsUrl, title: text(500).optional() })
  .strict();

export const bundleItemLine = z
  .object({
    t: z.literal("item"),
    project: id,
    id,
    url: httpsUrl.optional(),
    type: opaque(80).optional(),
    title: text(500),
    description: text(BUNDLE_CAPS.commentChars).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    state: id,
    assignee: id.optional(),
    requester: id.optional(),
    createdBy: id.optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
    resolvedAt: isoDateTime.optional(),
    startDate: isoDateTime.optional(),
    dueDate: isoDateTime.optional(),
    parent: id.optional(),
    labels: z.array(id).max(100).optional(),
    estimate: z.union([z.number().finite(), opaque(40)]).optional(),
    cycle: opaque(200).optional(),
    modules: z.array(opaque(200)).max(100).optional(),
    comments: z.array(bundleComment).max(BUNDLE_CAPS.comments).optional(),
    attachments: z
      .array(bundleAttachment)
      .max(BUNDLE_CAPS.attachments)
      .optional(),
    relations: z.array(bundleRelation).max(BUNDLE_CAPS.relations).optional(),
    history: z.array(bundleHistory).max(BUNDLE_CAPS.history).optional(),
    links: z.array(bundleLink).max(BUNDLE_CAPS.links).optional(),
  })
  .strict();

const LINE_SCHEMAS = {
  header: bundleHeaderLine,
  person: bundlePersonLine,
  project: bundleProjectLine,
  membership: bundleMembershipLine,
  state: bundleStateLine,
  label: bundleLabelLine,
  item: bundleItemLine,
} as const;

export type BundleHeader = z.infer<typeof bundleHeaderLine>;
export type BundlePerson = z.infer<typeof bundlePersonLine>;
export type BundleProject = z.infer<typeof bundleProjectLine>;
export type BundleMembership = z.infer<typeof bundleMembershipLine>;
export type BundleState = z.infer<typeof bundleStateLine>;
export type BundleLabel = z.infer<typeof bundleLabelLine>;
export type BundleItem = z.infer<typeof bundleItemLine>;
type BundleLine =
  | BundleHeader
  | BundlePerson
  | BundleProject
  | BundleMembership
  | BundleState
  | BundleLabel
  | BundleItem;

/** A line-addressed problem. Fixed `code` plus the field path: never an echo of the file's content. */
export type BundleIssue = { line: number; code: string; path?: string };

export type ParsedBundle = {
  header: BundleHeader | null;
  people: Map<string, BundlePerson>;
  projects: Map<string, BundleProject>;
  memberships: BundleMembership[];
  states: Map<string, BundleState>;
  labels: Map<string, BundleLabel>;
  /** In file order. */
  items: BundleItem[];
  errors: BundleIssue[];
  /** Total errors found; `errors` holds at most `maxIssues` of them. */
  errorCount: number;
  /** Not blocking: for example a parent or relation target that is not in this file. */
  warnings: BundleIssue[];
};

/**
 * Splits NDJSON, validates every line with its schema, then checks references. Never throws.
 * Deterministic: the same text always gives the same result.
 */
export function parseBundleText(
  input: string,
  options: { maxIssues?: number } = {},
): ParsedBundle {
  const maxIssues = options.maxIssues ?? 50;
  const out: ParsedBundle = {
    header: null,
    people: new Map(),
    projects: new Map(),
    memberships: [],
    states: new Map(),
    labels: new Map(),
    items: [],
    errors: [],
    errorCount: 0,
    warnings: [],
  };
  const fail = (line: number, code: string, path?: string) => {
    out.errorCount += 1;
    if (out.errors.length < maxIssues)
      out.errors.push({ line, code, ...(path ? { path } : {}) });
  };
  const warn = (line: number, code: string, path?: string) => {
    if (out.warnings.length < maxIssues)
      out.warnings.push({ line, code, ...(path ? { path } : {}) });
  };
  if (new TextEncoder().encode(input).length > MAX_BUNDLE_BYTES) {
    fail(0, "bundle_too_large");
    return out;
  }
  const lineOf = new Map<unknown, number>();
  const projectKeys = new Set<string>();
  const itemIds = new Set<string>();
  let first = true;
  const rows = input.split("\n");
  for (let index = 0; index < rows.length; index += 1) {
    const raw = (rows[index] ?? "").replace(/\r$/u, "");
    if (raw.trim() === "") continue;
    const line = index + 1;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      fail(line, "invalid_json");
      first = false;
      continue;
    }
    const type = (json as { t?: unknown } | null)?.t;
    if (first && type !== "header") fail(line, "header_not_first");
    first = false;
    const schema =
      typeof type === "string" && Object.hasOwn(LINE_SCHEMAS, type)
        ? LINE_SCHEMAS[type as keyof typeof LINE_SCHEMAS]
        : null;
    if (!schema) {
      fail(line, "unknown_line_type");
      continue;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      fail(
        line,
        "invalid_line",
        parsed.error.issues[0]?.path.join(".") || undefined,
      );
      continue;
    }
    const value = parsed.data as BundleLine;
    lineOf.set(value, line);
    switch (value.t) {
      case "header":
        if (out.header) fail(line, "duplicate_header");
        else out.header = value;
        break;
      case "person":
        if (out.people.has(value.id)) fail(line, "duplicate_id", "id");
        out.people.set(value.id, value);
        break;
      case "project":
        if (out.projects.has(value.id)) fail(line, "duplicate_id", "id");
        if (projectKeys.has(value.key.toLowerCase()))
          fail(line, "duplicate_id", "key");
        projectKeys.add(value.key.toLowerCase());
        out.projects.set(value.id, value);
        break;
      case "membership":
        out.memberships.push(value);
        break;
      case "state":
        if (out.states.has(value.id)) fail(line, "duplicate_id", "id");
        out.states.set(value.id, value);
        break;
      case "label":
        if (out.labels.has(value.id)) fail(line, "duplicate_id", "id");
        out.labels.set(value.id, value);
        break;
      case "item":
        if (itemIds.has(value.id)) fail(line, "duplicate_id", "id");
        itemIds.add(value.id);
        out.items.push(value);
        if (out.items.length === MAX_BUNDLE_ITEMS + 1)
          fail(line, "too_many_items");
        break;
    }
  }
  if (!out.header) fail(0, "header_missing");

  // References. A person, state, label or project that is not in the file is an error: the file is
  // not self-contained. A parent or relation target missing from the file is only a warning: a
  // bundle is one file per project and the target may live in another project's file.
  const at = (value: unknown) => lineOf.get(value) ?? 0;
  const person = (line: number, ref: string | undefined, path: string) => {
    if (ref !== undefined && !out.people.has(ref))
      fail(line, "dangling_reference", path);
  };
  for (const m of out.memberships) {
    if (!out.projects.has(m.project))
      fail(at(m), "dangling_reference", "project");
    person(at(m), m.person, "person");
  }
  for (const s of [...out.states.values(), ...out.labels.values()])
    if (!out.projects.has(s.project))
      fail(at(s), "dangling_reference", "project");
  for (const item of out.items) {
    const line = at(item);
    if (!out.projects.has(item.project))
      fail(line, "dangling_reference", "project");
    const state = out.states.get(item.state);
    if (!state || state.project !== item.project)
      fail(line, "dangling_reference", "state");
    for (const labelId of item.labels ?? []) {
      const label = out.labels.get(labelId);
      if (!label || label.project !== item.project)
        fail(line, "dangling_reference", "labels");
    }
    person(line, item.assignee, "assignee");
    person(line, item.requester, "requester");
    person(line, item.createdBy, "createdBy");
    for (const c of item.comments ?? [])
      person(line, c.author, "comments.author");
    for (const a of item.attachments ?? [])
      person(line, a.author, "attachments.author");
    for (const h of item.history ?? [])
      person(line, h.author, "history.author");
    for (const [list, path] of [
      [item.comments, "comments"],
      [item.attachments, "attachments"],
      [item.history, "history"],
    ] as const) {
      const ids = (list ?? []).map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) fail(line, "duplicate_id", path);
    }
    if (item.parent === item.id) fail(line, "self_reference", "parent");
    else if (item.parent !== undefined && !itemIds.has(item.parent))
      warn(line, "unresolved_item_reference", "parent");
    for (const r of item.relations ?? []) {
      if (r.target === item.id) fail(line, "self_reference", "relations");
      else if (!itemIds.has(r.target))
        warn(line, "unresolved_item_reference", "relations");
    }
  }
  const emails = new Set<string>();
  for (const p of out.people.values()) {
    if (!p.email) continue;
    const key = p.email.toLowerCase();
    if (emails.has(key)) warn(at(p), "duplicate_person_email", "email");
    emails.add(key);
  }
  return out;
}

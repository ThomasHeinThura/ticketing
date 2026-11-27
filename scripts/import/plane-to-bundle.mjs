#!/usr/bin/env node
/**
 * Converts a Plane workspace (REST API v1, GET only) into TaskDesk import bundles (NDJSON,
 * bundleVersion 1; see apps/api/src/imports/adapters/bundle/schema.ts), one file per project plus
 * people.ndjson. Run it on a machine that can reach Plane: the API key never leaves it.
 *
 *   node scripts/import/plane-to-bundle.mjs --base https://plane.lan --workspace acme \
 *     --token-file ~/.plane-token --out ./bundle [--project WEB] [--no-attachments] [--allow-http]
 *
 * Node >= 20, global fetch, no dependencies. The key is read from --token-file, sent only as the
 * X-API-Key header to --base, and never printed, logged or written to a bundle: errors name only the
 * HTTP status and the request path. Redirects are refused (a redirect would forward the header).
 * Each project file is self-contained (people, states, labels and items), so it loads as one source.
 */
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PER_PAGE = 100;
const MAX_RETRIES = 6;
const MAX_BUNDLE_BYTES = 8_000_000;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"];
const CAPS = { comments: 500, attachments: 100, relations: 200, history: 1000 };
const ENTITY = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};
const RELATIONS = [
  ["blocking", "blocks"],
  ["blocked_by", "requires"],
  ["duplicate", "duplicates"],
  ["relates_to", "relates"],
  ["start_before", "precedes"],
  ["finish_before", "precedes"],
  ["start_after", "requires"],
  ["finish_after", "requires"],
];
const HISTORY_FIELDS = {
  name: "title",
  state: "state",
  priority: "priority",
  assignees: "assignee",
  labels: "labels",
  parent: "parent",
  start_date: "start_date",
  target_date: "due_date",
  estimate_point: "estimate",
  cycles: "cycle",
  modules: "module",
};

/** Failure with a fixed message: a status and a path, never a header, a token or a response body. */
export class ConvertError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const isRecord = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.length > 0 ? v : undefined);
const iso = (v) => {
  const time = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
};
const clean = (value, max) =>
  [...value]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .slice(0, max);

/** Plain text from Plane HTML. Entities decode first, then tags strip to a fixed point. */
export function htmlToText(html) {
  let text = html
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/giu, "\n")
    .replace(/<li[^>]*>/giu, "- ")
    .replace(/&(#?\w+);/gu, (whole, name) => ENTITY[name] ?? whole);
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^>]*(?:>|$)/gu, "");
  }
  return clean(
    text
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    100_000,
  );
}

/** https, no credentials, no credential-like query key, no fragment; else undefined. */
function safeUrl(value) {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const bad = [...url.searchParams.keys()].some((k) =>
      /(?:token|secret|password|authorization|api[-_]?key|credential|signature|^sig$)/iu.test(
        k,
      ),
    );
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !bad &&
      !url.hash
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** GET-only client over `fetch`. `fetchImpl` and `sleep` are injectable for tests. */
export function createClient({
  base,
  workspace,
  token,
  fetchImpl = fetch,
  sleep,
}) {
  const wait =
    sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const root = `${base}/api/v1/workspaces/${encodeURIComponent(workspace)}`;
  async function get(path) {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(`${root}${path}`, {
          method: "GET",
          headers: { "x-api-key": token, accept: "application/json" },
          redirect: "error",
        });
      } catch {
        throw new ConvertError(`network error on ${path.split("?")[0]}`);
      }
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await wait(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 60) * 1000
            : Math.min(1000 * 2 ** attempt, 30_000),
        );
        continue;
      }
      if (!response.ok)
        throw new ConvertError(
          `HTTP ${response.status} on ${path.split("?")[0]}`,
          response.status,
        );
      try {
        return await response.json();
      } catch {
        throw new ConvertError(`invalid response on ${path.split("?")[0]}`);
      }
    }
  }
  const listOf = (body) =>
    Array.isArray(body)
      ? body
      : Array.isArray(body?.results)
        ? body.results
        : [];
  /** Every page of a cursor-paginated list. */
  async function all(path) {
    const out = [];
    let cursor;
    const join = path.includes("?") ? "&" : "?";
    for (let guard = 0; guard < 10_000; guard += 1) {
      const body = await get(
        `${path}${join}per_page=${PER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      out.push(...listOf(body));
      const next = isRecord(body) ? str(body.next_cursor) : undefined;
      if (!isRecord(body) || body.next_page_results !== true || !next) break;
      cursor = next;
    }
    return out;
  }
  return { get, all, listOf };
}

function parseMember(entry) {
  if (!isRecord(entry)) return null;
  const inner = isRecord(entry.member) ? entry.member : entry;
  const id = str(inner.id) ?? str(inner.member_id);
  if (!id) return null;
  const email = str(inner.email);
  const name =
    str(inner.display_name) ??
    [str(inner.first_name), str(inner.last_name)].filter(Boolean).join(" ") ??
    undefined;
  const role = Number(entry.role ?? inner.role);
  return {
    id,
    ...(email && EMAIL.test(email) && email.length <= 320 ? { email } : {}),
    ...(name ? { name: clean(name, 200) } : {}),
    role: Number.isFinite(role) ? role : undefined,
  };
}

const ROLE = { 20: "lead", 15: "member", 5: "viewer" };

/**
 * Converts the workspace. Returns counts only. `writeLine(file, object)` style output is done through
 * files in `out`; the header line is written first in every file.
 */
export async function convert({
  base,
  workspace,
  token,
  out,
  only,
  attachments = true,
  fetchImpl,
  sleep,
  now = () => new Date(),
}) {
  const client = createClient({ base, workspace, token, fetchImpl, sleep });
  const header = {
    t: "header",
    bundleVersion: 1,
    source: {
      system: "plane",
      instance: new URL(base).host,
      workspace,
      exportedAt: now().toISOString(),
    },
  };
  await mkdir(out, { recursive: true });
  const members = new Map();
  for (const entry of client.listOf(await client.get("/members/"))) {
    const member = parseMember(entry);
    if (member) members.set(member.id, member);
  }
  const personLine = (m) => ({
    t: "person",
    id: m.id,
    ...(m.email ? { email: m.email } : {}),
    ...(m.name ? { name: m.name } : {}),
  });
  const summary = { projects: [], skipped: {} };
  const skip = (code) => {
    summary.skipped[code] = (summary.skipped[code] ?? 0) + 1;
  };

  const peopleHandle = await open(join(out, "people.ndjson"), "w");
  try {
    await peopleHandle.write(`${JSON.stringify(header)}\n`);
    for (const m of members.values())
      await peopleHandle.write(`${JSON.stringify(personLine(m))}\n`);
  } finally {
    await peopleHandle.close();
  }

  const projects = (await client.all("/projects/"))
    .filter((p) => isRecord(p) && str(p.id) && str(p.name) && str(p.identifier))
    .sort((a, b) => a.identifier.localeCompare(b.identifier))
    .filter((p) => !only || p.identifier === only || p.id === only);
  if (only && projects.length === 0)
    throw new ConvertError("project not found");

  for (const project of projects) {
    if (!KEY.test(project.identifier)) {
      skip("project_key_invalid");
      continue;
    }
    const file = join(out, `${project.identifier}.ndjson`);
    // The header carries this project's warnings, which are only known at the end: the body is
    // written first and the final file is header + body.
    const bodyFile = `${file}.body`;
    const handle = await open(bodyFile, "w");
    let bytes = 0;
    const warnings = [];
    const unsupported = new Set();
    /** A 404 on an optional endpoint is "not supported by this Plane": reported, never swallowed. */
    const optional = async (kind, fn, fallback) => {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof ConvertError) || error.status !== 404)
          throw error;
        if (!unsupported.has(kind)) {
          unsupported.add(kind);
          warnings.push({ code: "endpoint_not_supported", endpoint: kind });
        }
        return fallback;
      }
    };
    const warn = (code, item, omitted) =>
      warnings.push({ code, item, omitted });
    const emit = async (line) => {
      const text = `${JSON.stringify(line)}\n`;
      bytes += Buffer.byteLength(text, "utf8");
      await handle.write(text);
    };
    const known = new Set(members.keys());
    const extraPeople = new Set();
    const person = (id) => {
      const ref = str(id);
      if (!ref) return undefined;
      if (!known.has(ref)) extraPeople.add(ref);
      return ref;
    };
    try {
      const base_ = `/projects/${encodeURIComponent(project.id)}`;
      for (const m of members.values()) await emit(personLine(m));
      await emit({
        t: "project",
        id: project.id,
        key: project.identifier,
        name: clean(project.name, 200),
        ...(safeUrl(`${base}/${workspace}/projects/${project.id}/issues`)
          ? { url: `${base}/${workspace}/projects/${project.id}/issues` }
          : {}),
      });
      let membershipCount = 0;
      for (const entry of await optional(
        "members",
        () => client.all(`${base_}/members/`),
        [],
      )) {
        const m = parseMember(entry);
        if (!m) continue;
        const role = ROLE[m.role];
        if (!role) {
          skip("membership_role_unknown");
          continue;
        }
        await emit({
          t: "membership",
          project: project.id,
          person: person(m.id),
          role,
          sourceRole: String(m.role),
        });
        membershipCount += 1;
      }
      const states = new Map();
      for (const s of await client.all(`${base_}/states/`)) {
        if (!isRecord(s) || !str(s.id) || !str(s.name)) continue;
        let group = str(s.group);
        if (!GROUPS.includes(group)) {
          skip("state_group_mapped_to_backlog");
          group = "backlog";
        }
        states.set(s.id, true);
        await emit({
          t: "state",
          project: project.id,
          id: s.id,
          name: clean(s.name, 200),
          group,
        });
      }
      const labels = new Map();
      for (const l of await client.all(`${base_}/labels/`)) {
        if (!isRecord(l) || !str(l.id) || !str(l.name)) continue;
        labels.set(l.id, true);
        await emit({
          t: "label",
          project: project.id,
          id: l.id,
          name: clean(l.name, 200),
          ...(str(l.color) ? { color: clean(l.color, 40) } : {}),
        });
      }
      const named = async (path) => {
        const map = new Map();
        for (const e of await optional(
          path.split("/").filter(Boolean).pop(),
          () => client.all(path),
          [],
        ))
          if (isRecord(e) && str(e.id) && str(e.name)) map.set(e.id, e.name);
        return map;
      };
      const types = await named(`${base_}/issue-types/`);
      const cycleOf = new Map();
      for (const [cycleId, cycleName] of await named(`${base_}/cycles/`))
        for (const e of await optional(
          "cycle-issues",
          () =>
            client.all(
              `${base_}/cycles/${encodeURIComponent(cycleId)}/cycle-issues/`,
            ),
          [],
        )) {
          const issue = isRecord(e) ? (str(e.issue) ?? str(e.id)) : undefined;
          if (issue && !cycleOf.has(issue)) cycleOf.set(issue, cycleName);
        }
      const modulesOf = new Map();
      for (const [moduleId, moduleName] of await named(`${base_}/modules/`))
        for (const e of await optional(
          "module-issues",
          () =>
            client.all(
              `${base_}/modules/${encodeURIComponent(moduleId)}/module-issues/`,
            ),
          [],
        )) {
          const issue = isRecord(e) ? (str(e.issue) ?? str(e.id)) : undefined;
          if (!issue) continue;
          const list = modulesOf.get(issue) ?? [];
          if (!list.includes(moduleName)) list.push(moduleName);
          modulesOf.set(issue, list);
        }

      let items = 0;
      const seen = new Set();
      for (const issue of await client.all(
        `${base_}/issues/?order_by=created_at`,
      )) {
        const id = isRecord(issue) ? str(issue.id) : undefined;
        const title = isRecord(issue) ? str(issue.name) : undefined;
        const stateId = isRecord(issue)
          ? str(issue.state ?? issue.state_id)
          : undefined;
        if (!id || !title || !stateId || !states.has(stateId) || seen.has(id)) {
          skip("issue_unusable");
          continue;
        }
        seen.add(id);
        const issuePath = `${base_}/issues/${encodeURIComponent(id)}`;
        const [comments, files, relations, activities] = await Promise.all([
          client.all(`${issuePath}/comments/`),
          attachments
            ? optional(
                "issue-attachments",
                () => client.all(`${issuePath}/issue-attachments/`),
                [],
              )
            : [],
          optional(
            "relations",
            () => client.get(`${issuePath}/relations/`),
            {},
          ),
          optional(
            "activities",
            () => client.all(`${issuePath}/activities/`),
            [],
          ),
        ]);
        await emit(
          toItem({
            issue,
            id,
            title,
            stateId,
            project,
            comments,
            files,
            relations,
            activities,
            types,
            labels,
            cycleOf,
            modulesOf,
            person,
            base,
            workspace,
            skip,
            warn,
          }),
        );
        items += 1;
      }
      for (const id of extraPeople) await emit({ t: "person", id });
      await handle.close();
      const head = `${JSON.stringify({
        ...header,
        ...(warnings.length ? { warnings } : {}),
      })}\n`;
      bytes += Buffer.byteLength(head, "utf8");
      await writeFile(file, head + (await readFile(bodyFile, "utf8")));
      await rm(bodyFile, { force: true });
      summary.projects.push({
        key: project.identifier,
        items,
        memberships: membershipCount,
        bytes,
        warnings,
      });
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(bodyFile, { force: true });
      throw error;
    }
    if (bytes > MAX_BUNDLE_BYTES) skip("project_file_over_8mb");
  }
  return summary;
}

function toItem(c) {
  const {
    issue,
    id,
    title,
    stateId,
    project,
    types,
    labels,
    person,
    skip,
    warn,
  } = c;
  const priority = ["low", "medium", "high", "urgent"].includes(issue.priority)
    ? issue.priority
    : "medium"; // Plane "none" is Medium by contract
  const html = str(issue.description_html);
  const description =
    (html && html !== "<p></p>" ? htmlToText(html) : "") ||
    clean(str(issue.description_stripped) ?? "", 100_000);
  const item = {
    t: "item",
    project: project.id,
    id,
    title: clean(title, 500),
    state: stateId,
    priority,
  };
  const url = `${c.base}/${c.workspace}/projects/${project.id}/issues/${id}`;
  if (safeUrl(url)) item.url = url;
  const typeName = types.get(str(issue.type ?? issue.type_id) ?? "");
  if (typeName) item.type = clean(typeName, 80);
  if (description) item.description = description;
  const assignee = Array.isArray(issue.assignees)
    ? person(issue.assignees[0])
    : undefined;
  if (assignee) item.assignee = assignee;
  if (Array.isArray(issue.assignees) && issue.assignees.length > 1)
    skip("extra_assignees_dropped");
  const createdBy = person(issue.created_by);
  if (createdBy) item.createdBy = createdBy;
  for (const [field, key] of [
    ["createdAt", "created_at"],
    ["updatedAt", "updated_at"],
    ["resolvedAt", "completed_at"],
    ["startDate", "start_date"],
    ["dueDate", "target_date"],
  ]) {
    const value = iso(issue[key]);
    if (value) item[field] = value;
  }
  if (str(issue.parent)) item.parent = issue.parent;
  const own = (Array.isArray(issue.labels) ? issue.labels : []).filter(
    (l) => typeof l === "string" && labels.has(l),
  );
  if (own.length) item.labels = [...new Set(own)];
  if (
    issue.estimate_point !== null &&
    issue.estimate_point !== undefined &&
    String(issue.estimate_point) !== ""
  )
    item.estimate =
      typeof issue.estimate_point === "number"
        ? issue.estimate_point
        : clean(String(issue.estimate_point), 40);
  const cycle = c.cycleOf.get(id);
  if (cycle) item.cycle = clean(cycle, 200);
  const modules = c.modulesOf.get(id);
  if (modules?.length) item.modules = modules.map((m) => clean(m, 200));

  const comments = [];
  for (const raw of c.comments) {
    if (!isRecord(raw) || !str(raw.id)) continue;
    const body = str(raw.comment_html)
      ? htmlToText(raw.comment_html)
      : clean(str(raw.comment_stripped) ?? "", 100_000);
    if (!body) continue;
    const author = person(raw.actor ?? raw.created_by);
    comments.push({
      id: raw.id,
      ...(author ? { author } : {}),
      ...(iso(raw.created_at) ? { createdAt: iso(raw.created_at) } : {}),
      ...(iso(raw.updated_at) ? { updatedAt: iso(raw.updated_at) } : {}),
      visibility: "internal", // Plane has no public/internal distinction
      body,
    });
  }
  if (comments.length) item.comments = comments.slice(0, CAPS.comments);
  if (comments.length > CAPS.comments)
    warn("comments_truncated", id, comments.length - CAPS.comments);

  const attachments = [];
  for (const raw of c.files) {
    if (!isRecord(raw) || !str(raw.id)) continue;
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const name = str(attributes.name);
    let url2;
    try {
      url2 = str(raw.asset)
        ? safeUrl(new URL(raw.asset, c.base).toString())
        : undefined;
    } catch {
      url2 = undefined;
    }
    const filename = name ? clean(name.replace(/[\\/\t\n]/gu, "_"), 255) : "";
    if (!url2 || !filename) {
      skip("attachment_unusable");
      continue;
    }
    const author = person(raw.created_by);
    const size = Number(attributes.size);
    attachments.push({
      id: raw.id,
      url: url2,
      filename,
      ...(str(attributes.type)
        ? { mimeType: clean(attributes.type, 200) }
        : {}),
      ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
      ...(author ? { author } : {}),
      ...(iso(raw.created_at) ? { createdAt: iso(raw.created_at) } : {}),
    });
  }
  if (attachments.length)
    item.attachments = attachments.slice(0, CAPS.attachments);
  if (attachments.length > CAPS.attachments)
    warn("attachments_truncated", id, attachments.length - CAPS.attachments);

  const relations = [];
  const rel = isRecord(c.relations) ? c.relations : {};
  for (const [key, type] of RELATIONS)
    for (const target of Array.isArray(rel[key]) ? rel[key] : []) {
      const targetId =
        typeof target === "string"
          ? target
          : isRecord(target)
            ? str(target.id)
            : undefined;
      if (targetId && targetId !== id)
        relations.push({ type, target: targetId });
    }
  if (relations.length) item.relations = relations.slice(0, CAPS.relations);
  if (relations.length > CAPS.relations)
    warn("relations_truncated", id, relations.length - CAPS.relations);

  const history = [];
  for (const raw of c.activities) {
    if (!isRecord(raw) || !str(raw.id) || !iso(raw.created_at)) continue;
    const field = HISTORY_FIELDS[raw.field];
    if (!field) {
      skip("history_field_not_carried");
      continue;
    }
    const scalar = (v) =>
      v === null || v === undefined ? null : String(v).slice(0, 2000);
    const author = person(raw.actor);
    history.push({
      id: raw.id,
      at: iso(raw.created_at),
      ...(author ? { author } : {}),
      field,
      from: scalar(raw.old_value),
      to: scalar(raw.new_value),
    });
  }
  if (history.length) item.history = history.slice(0, CAPS.history);
  if (history.length > CAPS.history)
    warn("history_truncated", id, history.length - CAPS.history);
  return item;
}

const USAGE =
  "Usage: plane-to-bundle.mjs --base https://plane.example --workspace <slug> --token-file <file> --out <dir> [--project <KEY>] [--no-attachments] [--allow-http]";

export function parseArgs(argv) {
  const args = { attachments: true, allowHttp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      i += 1;
      const next = argv[i];
      if (next === undefined)
        throw new ConvertError(`missing value for ${flag}`);
      return next;
    };
    if (flag === "--base") args.base = value();
    else if (flag === "--workspace") args.workspace = value();
    else if (flag === "--token-file") args.tokenFile = value();
    else if (flag === "--out") args.out = value();
    else if (flag === "--project") args.only = value();
    else if (flag === "--no-attachments") args.attachments = false;
    else if (flag === "--allow-http") args.allowHttp = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new ConvertError(`unknown option ${flag}`);
  }
  return args;
}

export async function main(
  argv,
  { fetchImpl, sleep, stdout = process.stdout } = {},
) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (!args.base || !args.workspace || !args.tokenFile || !args.out)
    throw new ConvertError(USAGE);
  if (!SLUG.test(args.workspace))
    throw new ConvertError("invalid workspace slug");
  let url;
  try {
    url = new URL(args.base);
  } catch {
    throw new ConvertError("invalid --base");
  }
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(args.allowHttp && url.protocol === "http:"))
  )
    throw new ConvertError(
      "--base must be an https URL without credentials (--allow-http permits http)",
    );
  let token;
  try {
    token = (await readFile(args.tokenFile, "utf8")).trim();
  } catch {
    throw new ConvertError("cannot read the token file");
  }
  if (!token) throw new ConvertError("the token file is empty");
  const summary = await convert({
    base: `${url.origin}${url.pathname.replace(/\/+$/u, "")}`,
    workspace: args.workspace,
    token,
    out: args.out,
    only: args.only,
    attachments: args.attachments,
    fetchImpl,
    sleep,
  });
  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      // Only fixed messages from ConvertError reach stderr; anything else is reduced to a constant.
      process.stderr.write(
        `error: ${error instanceof ConvertError ? error.message : "unexpected failure"}\n`,
      );
      process.exit(1);
    },
  );
}

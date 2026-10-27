/**
 * Plane import source adapter (P6 Lane C3). READ-ONLY, GET only.
 *
 * REST: workspace slug + API key (`X-API-Key`). Reads projects, issues (state groups, priority,
 * labels, type, estimate, parent), cycles and modules (membership), comments, attachment metadata,
 * relations and activity. Direct Postgres read is deferred: this adapter never opens a database
 * connection (see docs/technical/import-and-cutover.md, "Direct database read").
 *
 * Config (non-secret): `{ workspace, baseUrl?, webUrl?, project? }`. The key is the connection
 * credential and never appears in a returned value, loss or error.
 */
import type {
  AdapterConnection,
  ConnectFailureReason,
  ConnectResult,
  DiscoveredFacet,
  DiscoverHooks,
  DiscoveryResult,
  ImportAttachmentAuth,
  ImportSourceAdapter,
  MappingDomain,
  ProposalContext,
  ProposedMapping,
  SourcePage,
  SourceRecord,
} from "../../engine/adapter";
import {
  isUnreadableRecord,
  registerImportAdapter,
  unreadableRecord,
} from "../../engine/adapter";
import {
  asArray,
  createGuardedTransport,
  isRecord,
  SourceHttpError,
  type SourceTransport,
  str,
} from "../azure-devops/http";

import {
  groupOfStateFacet,
  PLANE_PRIORITY,
  type PlaneIssueContext,
  type PlaneLookups,
  type PlaneMember,
  type PlanePage,
  type PlaneProjectRef,
  parseMember,
  proposePlaneRoles,
  type RoleProposal,
  toPage,
  toRecord,
} from "./normalize";

const MAX_PAGE = 500;
const API_MAX_PER_PAGE = 100;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

export type PlaneAdapterOptions = {
  transport?: SourceTransport;
  /** Override the source page size (tests only; the engine caps at 500). */
  chunkSize?: number;
};

type PlaneConfig = {
  apiBase: string;
  webUrl: string;
  slug: string;
  project?: string;
};

function httpsOrigin(
  value: string | undefined,
  fallback: string,
): string | null {
  const raw = value ?? fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

function parseConfig(connection: AdapterConnection): PlaneConfig | null {
  const slug = str(connection.config.workspace);
  if (!slug || !SLUG.test(slug)) return null;
  const apiBase = httpsOrigin(
    str(connection.config.baseUrl),
    "https://api.plane.so",
  );
  if (!apiBase) return null;
  const webUrl = httpsOrigin(
    str(connection.config.webUrl),
    apiBase === "https://api.plane.so" ? "https://app.plane.so" : apiBase,
  );
  if (!webUrl) return null;
  const project = str(connection.config.project);
  return { apiBase, webUrl, slug, ...(project ? { project } : {}) };
}

/** GET-only client. Never echoes the credential; failures are fixed codes. */
class PlaneClient {
  constructor(
    private readonly config: PlaneConfig,
    private readonly key: string,
    private readonly transport: SourceTransport,
  ) {}

  async get(path: string): Promise<unknown> {
    const response = await this.transport({
      method: "GET",
      url: `${this.config.apiBase}/api/v1/workspaces/${encodeURIComponent(this.config.slug)}${path}`,
      headers: { "x-api-key": this.key },
    });
    if (response.status === 401 || response.status === 403)
      throw new SourceHttpError("source_unauthorized");
    if (response.status === 404) throw new SourceHttpError("source_not_found");
    if (response.status === 429)
      throw new SourceHttpError("source_rate_limited");
    if (response.status < 200 || response.status >= 300)
      throw new SourceHttpError("source_unavailable");
    return response.json;
  }
}

const listOf = (body: unknown): unknown[] =>
  Array.isArray(body) ? body : asArray(isRecord(body) ? body.results : []);

/** All pages of a cursor-paginated list endpoint (small collections only). */
async function allOf(client: PlaneClient, path: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor: string | undefined;
  const join = path.includes("?") ? "&" : "?";
  for (let guard = 0; guard < 1000; guard += 1) {
    const body = await client.get(
      `${path}${join}per_page=${API_MAX_PER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    out.push(...listOf(body));
    const next = isRecord(body) ? str(body.next_cursor) : undefined;
    if (!isRecord(body) || body.next_page_results !== true || !next) break;
    cursor = next;
  }
  return out;
}

async function listProjects(
  client: PlaneClient,
  only: string | undefined,
): Promise<PlaneProjectRef[]> {
  const projects = (await allOf(client, "/projects/"))
    .map((entry): PlaneProjectRef | null => {
      if (!isRecord(entry)) return null;
      const id = str(entry.id);
      const name = str(entry.name);
      const identifier = str(entry.identifier);
      return id && name && identifier ? { id, name, identifier } : null;
    })
    .filter((entry): entry is PlaneProjectRef => entry !== null)
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
  return only
    ? projects.filter((p) => p.identifier === only || p.id === only)
    : projects;
}

async function loadMembers(
  client: PlaneClient,
): Promise<Map<string, PlaneMember>> {
  const members = new Map<string, PlaneMember>();
  for (const entry of listOf(await client.get("/members/"))) {
    const member = parseMember(entry);
    if (member) members.set(member.id, member);
  }
  return members;
}

async function loadLookups(
  client: PlaneClient,
  project: PlaneProjectRef,
  members: ReadonlyMap<string, PlaneMember>,
): Promise<PlaneLookups> {
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const states = new Map<string, { name: string; group: string }>();
  for (const entry of await allOf(client, `${base}/states/`)) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    const name = str(entry.name);
    const group = str(entry.group);
    if (id && name && group) states.set(id, { name, group });
  }
  const named = async (path: string) => {
    const map = new Map<string, string>();
    for (const entry of await allOf(client, path)) {
      if (!isRecord(entry)) continue;
      const id = str(entry.id);
      const name = str(entry.name);
      if (id && name) map.set(id, name);
    }
    return map;
  };
  const labels = await named(`${base}/labels/`);
  const types = await named(`${base}/issue-types/`).catch(
    () => new Map<string, string>(),
  );
  const cycles = await named(`${base}/cycles/`);
  const modules = await named(`${base}/modules/`);
  const cycleOf = new Map<string, string>();
  for (const [cycleId, cycleName] of cycles)
    for (const entry of await allOf(
      client,
      `${base}/cycles/${encodeURIComponent(cycleId)}/cycle-issues/`,
    )) {
      const issue = isRecord(entry)
        ? (str(entry.issue) ?? str(entry.id))
        : undefined;
      if (issue && !cycleOf.has(issue)) cycleOf.set(issue, cycleName);
    }
  const modulesOf = new Map<string, string[]>();
  for (const [moduleId, moduleName] of modules)
    for (const entry of await allOf(
      client,
      `${base}/modules/${encodeURIComponent(moduleId)}/module-issues/`,
    )) {
      const issue = isRecord(entry)
        ? (str(entry.issue) ?? str(entry.id))
        : undefined;
      if (!issue) continue;
      const list = modulesOf.get(issue) ?? [];
      if (!list.includes(moduleName)) list.push(moduleName);
      modulesOf.set(issue, list);
    }
  return { members, states, labels, types, cycleOf, modulesOf };
}

/**
 * An issue Plane returned that cannot become a record: no id (a deterministic position id stands in,
 * so a re-read reports the same one) or no title. Never dropped: it is counted and reported.
 */
function planeUnreadable(
  issue: Record<string, unknown>,
  projectId: string,
  startCursor: string,
  index: number,
): SourceRecord {
  const id = str(issue.id);
  return unreadableRecord({
    sourceType: "issue",
    sourceId: id ?? `missing_id:${projectId}:${startCursor || "0"}:${index}`,
    code: id ? "missing_title" : "missing_id",
  });
}

/** Largest per-page value <= 100 that divides the requested page size evenly. */
function perPageFor(size: number): number {
  if (size <= API_MAX_PER_PAGE) return size;
  for (let candidate = API_MAX_PER_PAGE; candidate > 1; candidate -= 1)
    if (size % candidate === 0) return candidate;
  return 1;
}

/** Cursor `projectIndex|planeCursor`. Anything else restarts from the beginning. */
function parseCursor(cursor: string | null): { p: number; c: string } {
  if (cursor === null) return { p: 0, c: "" };
  const index = cursor.indexOf("|");
  const p = Number(cursor.slice(0, index));
  return index > 0 && Number.isInteger(p) && p >= 0
    ? { p, c: cursor.slice(index + 1) }
    : { p: 0, c: "" };
}

function clientFor(
  connection: AdapterConnection,
  config: PlaneConfig,
  transport: SourceTransport,
): PlaneClient {
  if (!connection.credential) throw new SourceHttpError("credential_missing");
  return new PlaneClient(config, connection.credential, transport);
}

/** Fixed reason a connect failed, from the source error code (never the message or URL). */
function failureReason(error: unknown): ConnectFailureReason {
  const code = error instanceof SourceHttpError ? error.code : "";
  switch (code) {
    case "source_unauthorized":
    case "credential_missing":
      return "auth_failed";
    case "source_not_found":
      return "not_found";
    case "source_unavailable":
    case "source_rate_limited":
    case "destination_refused":
      return "unreachable";
    default:
      return "source_error";
  }
}

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_|_$/gu, "");

export type PlaneAdapter = ImportSourceAdapter & {
  /** Pages, unpublished and staff-only. Not part of the run until the engine has a page target. */
  readPages(connection: AdapterConnection): Promise<PlanePage[]>;
  /** Role proposals for human review (never confirmed; the engine has no role domain). */
  proposeRoles(connection: AdapterConnection): Promise<RoleProposal[]>;
};

export function createPlaneAdapter(
  options: PlaneAdapterOptions = {},
): PlaneAdapter {
  const transport = options.transport ?? createGuardedTransport();
  const chunkSize = Math.min(options.chunkSize ?? MAX_PAGE, MAX_PAGE);

  async function scan(
    connection: AdapterConnection,
    hooks?: DiscoverHooks,
  ): Promise<DiscoveryResult> {
    const config = parseConfig(connection);
    if (!config) throw new SourceHttpError("config_invalid");
    const client = clientFor(connection, config, transport);
    const members = await loadMembers(client);
    const counts: Record<string, number> = {};
    const facets = new Map<string, DiscoveredFacet>();
    const add = (domain: MappingDomain, value: string) => {
      const key = JSON.stringify([domain, value]);
      const current = facets.get(key);
      if (current) current.count += 1;
      else facets.set(key, { domain, value, count: 1 });
    };
    let total = 0;
    let pages = 0;
    const unreadable: Record<string, number> = {};
    for (const project of await listProjects(client, config.project)) {
      const lookups = await loadLookups(client, project, members);
      const issues = await allOf(
        client,
        `/projects/${encodeURIComponent(project.id)}/issues/?order_by=created_at`,
      );
      for (const [index, issue] of issues.entries()) {
        if (!isRecord(issue)) continue;
        const record =
          toRecord(issue, {
            slug: config.slug,
            webUrl: config.webUrl,
            project,
            lookups,
          }) ?? planeUnreadable(issue, project.id, "", index);
        total += 1;
        counts[record.sourceType] = (counts[record.sourceType] ?? 0) + 1;
        if (isUnreadableRecord(record)) {
          const code = record.rejectCode as string;
          unreadable[code] = (unreadable[code] ?? 0) + 1;
          continue;
        }
        for (const facet of record.facets) add(facet.domain, facet.value);
        if (record.assigneeEmail)
          add("person", record.assigneeEmail.toLowerCase());
        if (record.sourceAuthorEmail)
          add("person", record.sourceAuthorEmail.toLowerCase());
      }
      pages += 1;
      await hooks?.onProgress?.({ pages, records: total });
    }
    return {
      facets: [...facets.values()],
      counts,
      totalRecords: total,
      ...(Object.keys(unreadable).length ? { unreadable } : {}),
    };
  }

  return {
    pluginId: "import.plane",
    chunkSize,
    async connect(connection): Promise<ConnectResult> {
      const config = parseConfig(connection);
      if (!config) return { ok: false, reason: "invalid_configuration" };
      try {
        const client = clientFor(connection, config, transport);
        const projects = await listProjects(client, config.project);
        if (config.project && projects.length === 0)
          return { ok: false, reason: "not_found" };
        return { ok: true, label: config.slug };
      } catch (error) {
        return { ok: false, reason: failureReason(error) };
      }
    },
    attachmentAuth(connection): ImportAttachmentAuth | null {
      const config = parseConfig(connection);
      if (!config || !connection.credential) return null;
      // The key goes only to the configured API host.
      return {
        headers: { "x-api-key": connection.credential },
        hosts: [new URL(config.apiBase).hostname],
      };
    },
    discover: scan,
    async proposeMapping(
      discovery: DiscoveryResult,
      context: ProposalContext,
    ): Promise<ProposedMapping[]> {
      const proposals: ProposedMapping[] = [];
      for (const facet of discovery.facets) {
        if (facet.domain === "state") {
          // Plane's groups equal ours, so the source group is the proposal. A group outside the
          // five (for example `triage`) yields no proposal and stays unmapped.
          const group = groupOfStateFacet(facet.value);
          if (group)
            proposals.push({
              domain: "state",
              value: facet.value,
              target: { kind: "group", group },
              confidence: "exact",
            });
        } else if (facet.domain === "priority") {
          const mapped = PLANE_PRIORITY[facet.value];
          if (mapped)
            proposals.push({
              domain: "priority",
              value: facet.value,
              target: { kind: "priority", value: mapped.value },
              confidence: mapped.exact ? "exact" : "heuristic",
            });
        } else if (facet.domain === "type") {
          const id =
            context.typeIdsByKey.get(facet.value) ??
            context.typeIdsByKey.get(slug(facet.value));
          if (id)
            proposals.push({
              domain: "type",
              value: facet.value,
              target: { kind: "target", id },
              confidence: "heuristic",
            });
        } else if (facet.domain === "person") {
          const id = context.peopleByEmail.get(facet.value.toLowerCase());
          proposals.push({
            domain: "person",
            value: facet.value,
            target: id ? { kind: "target", id } : { kind: "placeholder" },
            confidence: id ? "exact" : "heuristic",
          });
        }
        // cycle, module, label and custom_field have no destination ids in the proposal context.
      }
      return proposals;
    },
    async readPage(connection, cursor, pageSize): Promise<SourcePage> {
      const config = parseConfig(connection);
      if (!config) throw new SourceHttpError("config_invalid");
      const client = clientFor(connection, config, transport);
      const size = Math.max(1, Math.min(pageSize, chunkSize, MAX_PAGE));
      const perPage = perPageFor(size);
      const projects = await listProjects(client, config.project);
      let { p, c } = parseCursor(cursor);
      let members: Map<string, PlaneMember> | null = null;
      while (p < projects.length) {
        const project = projects[p] as PlaneProjectRef;
        const base = `/projects/${encodeURIComponent(project.id)}`;
        const issues: Array<Record<string, unknown>> = [];
        let apiCursor = c;
        let hasNext = true;
        while (issues.length < size && hasNext) {
          const body = await client.get(
            `${base}/issues/?per_page=${perPage}&order_by=created_at${apiCursor ? `&cursor=${encodeURIComponent(apiCursor)}` : ""}`,
          );
          for (const entry of listOf(body))
            if (isRecord(entry)) issues.push(entry);
          const next = isRecord(body) ? str(body.next_cursor) : undefined;
          hasNext = isRecord(body) && body.next_page_results === true && !!next;
          if (next) apiCursor = next;
        }
        if (issues.length === 0 && !hasNext) {
          p += 1;
          c = "";
          continue;
        }
        members ??= await loadMembers(client);
        const lookups = await loadLookups(client, project, members);
        const records: SourceRecord[] = [];
        for (const [index, issue] of issues.entries()) {
          const id = str(issue.id);
          if (!id) {
            records.push(planeUnreadable(issue, project.id, c, index));
            continue;
          }
          const issuePath = `${base}/issues/${encodeURIComponent(id)}`;
          const context: PlaneIssueContext = {
            slug: config.slug,
            webUrl: config.webUrl,
            project,
            lookups,
            comments: await allOf(client, `${issuePath}/comments/`),
            attachments: await allOf(client, `${issuePath}/issue-attachments/`),
            relations: await client
              .get(`${issuePath}/relations/`)
              .catch(() => ({})),
            activities: await allOf(client, `${issuePath}/activities/`),
          };
          records.push(
            toRecord(issue, context) ??
              planeUnreadable(issue, project.id, c, index),
          );
        }
        const nextCursor = hasNext
          ? `${p}|${apiCursor}`
          : p + 1 < projects.length
            ? `${p + 1}|`
            : null;
        return { records, nextCursor };
      }
      return { records: [], nextCursor: null };
    },
    async readPages(connection): Promise<PlanePage[]> {
      const config = parseConfig(connection);
      if (!config) throw new SourceHttpError("config_invalid");
      const client = clientFor(connection, config, transport);
      const pages: PlanePage[] = [];
      for (const project of await listProjects(client, config.project))
        for (const raw of await allOf(
          client,
          `/projects/${encodeURIComponent(project.id)}/pages/`,
        )) {
          const page = toPage(raw, project.identifier);
          if (page) pages.push(page);
        }
      return pages;
    },
    async proposeRoles(connection): Promise<RoleProposal[]> {
      const config = parseConfig(connection);
      if (!config) throw new SourceHttpError("config_invalid");
      const members = await loadMembers(
        clientFor(connection, config, transport),
      );
      return proposePlaneRoles([...members.values()]);
    },
  };
}

export function registerPlaneAdapter(options: PlaneAdapterOptions = {}) {
  registerImportAdapter("import.plane", () => createPlaneAdapter(options));
}

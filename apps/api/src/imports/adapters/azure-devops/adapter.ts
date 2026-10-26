/**
 * Azure DevOps import source adapter (P6 Lane C3). READ-ONLY.
 *
 * REST mode: organisation + PAT (Work Items Read, Identity Read, Project and Team Read). Work items
 * come from WIQL (id keyset, so a resume after a crash is deterministic and the 20k WIQL result cap
 * never applies) plus the work items batch endpoint; comments and revision updates are read per
 * item. The only POSTs are the two read-only query endpoints, enforced by path whitelist; PUT,
 * PATCH and DELETE do not exist in the transport type.
 *
 * CSV mode (`config.mode = "csv"`, `config.csvText`): fields only, with explicit loss codes.
 *
 * Config (non-secret): `{ organization, project?, baseUrl?, mode? }`. The PAT is the connection
 * credential and never appears in a returned value, loss or error.
 */
import type {
  AdapterConnection,
  ConnectFailureReason,
  ConnectResult,
  DiscoveredFacet,
  DiscoveryResult,
  ImportAttachmentAuth,
  ImportSourceAdapter,
  MappingDomain,
  ProposalContext,
  ProposedMapping,
  SourcePage,
  SourceRecord,
} from "../../engine/adapter";
import { registerImportAdapter } from "../../engine/adapter";
import { csvRecords } from "./csv";
import {
  asArray,
  createGuardedTransport,
  isRecord,
  num,
  SourceHttpError,
  type SourceTransport,
  str,
} from "./http";
import { ADO_PRIORITY, normaliseProcess, proposeStateGroup } from "./mapping";
import { toRecord } from "./normalize";

const API = "api-version=7.1";
const MAX_PAGE = 200;
const SCAN_PAGE = 200;
const ORG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export type AzureDevOpsAdapterOptions = {
  transport?: SourceTransport;
  /** Override the source page size (tests only; the contract value is 200). */
  chunkSize?: number;
};

type AdoConfig =
  | { mode: "csv"; csvText: string; baseUrl: string; project?: string }
  | { mode: "rest"; baseUrl: string; project?: string };

function parseConfig(connection: AdapterConnection): AdoConfig | null {
  const config = connection.config;
  const org = str(config.organization);
  const explicit = str(config.baseUrl);
  let baseUrl: string | null = null;
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol === "https:" && !url.username && !url.password)
        baseUrl = `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
    } catch {
      baseUrl = null;
    }
  } else if (org && ORG.test(org)) baseUrl = `https://dev.azure.com/${org}`;
  if (!baseUrl) return null;
  const project = str(config.project);
  if (config.mode === "csv") {
    const csvText = str(config.csvText);
    return csvText
      ? { mode: "csv", csvText, baseUrl, ...(project ? { project } : {}) }
      : null;
  }
  return { mode: "rest", baseUrl, ...(project ? { project } : {}) };
}

/** Read-only client. Never echoes the credential; failures are fixed codes. */
class AdoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly pat: string,
    private readonly transport: SourceTransport,
  ) {}

  private headers() {
    return {
      authorization: `Basic ${Buffer.from(`:${this.pat}`, "utf8").toString("base64")}`,
    };
  }

  async get(path: string): Promise<unknown> {
    const response = await this.transport({
      method: "GET",
      url: `${this.baseUrl}${path}`,
      headers: this.headers(),
    });
    return this.ok(response.status, response.json);
  }

  /** POST is allowed only for the two read-only query endpoints. */
  async query(path: string, body: unknown): Promise<unknown> {
    const pathname = path.split("?")[0] ?? "";
    if (
      !pathname.endsWith("/_apis/wit/wiql") &&
      !pathname.endsWith("/_apis/wit/workitemsbatch")
    )
      throw new SourceHttpError("write_not_permitted");
    const response = await this.transport({
      method: "POST",
      url: `${this.baseUrl}${path}`,
      headers: this.headers(),
      body,
    });
    return this.ok(response.status, response.json);
  }

  private ok(status: number, json: unknown): unknown {
    if (status === 401 || status === 403 || status === 203)
      throw new SourceHttpError("source_unauthorized");
    if (status === 404) throw new SourceHttpError("source_not_found");
    if (status === 429) throw new SourceHttpError("source_rate_limited");
    if (status < 200 || status >= 300)
      throw new SourceHttpError("source_unavailable");
    return json;
  }
}

const enc = encodeURIComponent;

async function listProjects(
  client: AdoClient,
  only: string | undefined,
): Promise<string[]> {
  if (only) return [only];
  const body = await client.get(`/_apis/projects?$top=1000&${API}`);
  const names = asArray(isRecord(body) ? body.value : [])
    .map((entry) => (isRecord(entry) ? str(entry.name) : undefined))
    .filter((name): name is string => name !== undefined);
  return names.sort((a, b) => a.localeCompare(b));
}

async function projectProcess(
  client: AdoClient,
  project: string,
): Promise<string> {
  const body = await client.get(
    `/_apis/projects/${enc(project)}?includeCapabilities=true&${API}`,
  );
  const capabilities =
    isRecord(body) && isRecord(body.capabilities) ? body.capabilities : {};
  const template = isRecord(capabilities.processTemplate)
    ? str(capabilities.processTemplate.templateName)
    : undefined;
  if (!template) return "Unknown";
  return normaliseProcess(template) ?? template;
}

const wiqlQuote = (value: string) => value.replace(/'/gu, "''");

async function wiqlIds(
  client: AdoClient,
  project: string,
  lastId: number,
  top: number,
): Promise<number[]> {
  const body = await client.query(
    `/${enc(project)}/_apis/wit/wiql?$top=${top}&${API}`,
    {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${wiqlQuote(project)}' AND [System.Id] > ${lastId} ORDER BY [System.Id] ASC`,
    },
  );
  const ids = asArray(isRecord(body) ? body.workItems : [])
    .map((entry) => (isRecord(entry) ? num(entry.id) : undefined))
    .filter((id): id is number => id !== undefined)
    .sort((a, b) => a - b);
  return ids.slice(0, top);
}

async function batchItems(
  client: AdoClient,
  project: string,
  ids: number[],
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  const body = await client.query(
    `/${enc(project)}/_apis/wit/workitemsbatch?${API}`,
    { ids, $expand: "relations", errorPolicy: "Omit" },
  );
  const byId = new Map<number, Record<string, unknown>>();
  for (const entry of asArray(isRecord(body) ? body.value : [])) {
    if (isRecord(entry) && num(entry.id) !== undefined)
      byId.set(num(entry.id) as number, entry);
  }
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

async function itemComments(
  client: AdoClient,
  project: string,
  id: number,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let token: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const body = await client.get(
      `/${enc(project)}/_apis/wit/workItems/${id}/comments?$top=200${token ? `&continuationToken=${enc(token)}` : ""}&api-version=7.1-preview.4`,
    );
    if (!isRecord(body)) break;
    out.push(...asArray(body.comments));
    token = str(body.continuationToken);
    if (!token) break;
  }
  return out;
}

async function itemUpdates(
  client: AdoClient,
  project: string,
  id: number,
): Promise<unknown[]> {
  const out: unknown[] = [];
  const top = 200;
  for (let skip = 0; skip < 20_000; skip += top) {
    const body = await client.get(
      `/${enc(project)}/_apis/wit/workItems/${id}/updates?$top=${top}&$skip=${skip}&${API}`,
    );
    const page = asArray(isRecord(body) ? body.value : []);
    out.push(...page);
    if (page.length < top) break;
  }
  return out;
}

/** Cursor `projectIndex:lastId`. Anything else restarts from the beginning. */
function parseCursor(cursor: string | null): { p: number; last: number } {
  if (cursor === null) return { p: 0, last: 0 };
  const match = /^(\d+):(\d+)$/u.exec(cursor);
  return match
    ? { p: Number(match[1]), last: Number(match[2]) }
    : { p: 0, last: 0 };
}

function clientFor(
  connection: AdapterConnection,
  config: Extract<AdoConfig, { mode: "rest" }>,
  transport: SourceTransport,
): AdoClient {
  if (!connection.credential) throw new SourceHttpError("credential_missing");
  return new AdoClient(config.baseUrl, connection.credential, transport);
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
const TYPE_ALIASES: Record<string, string> = {
  user_story: "story",
  product_backlog_item: "story",
  feature: "epic",
  issue: "task",
  impediment: "task",
};

export function createAzureDevOpsAdapter(
  options: AzureDevOpsAdapterOptions = {},
): ImportSourceAdapter {
  const transport = options.transport ?? createGuardedTransport();
  const chunkSize = Math.min(options.chunkSize ?? MAX_PAGE, MAX_PAGE);

  async function scan(connection: AdapterConnection): Promise<DiscoveryResult> {
    const config = parseConfig(connection);
    if (!config) throw new SourceHttpError("config_invalid");
    const counts: Record<string, number> = {};
    const facets = new Map<string, DiscoveredFacet>();
    const add = (domain: MappingDomain, value: string) => {
      const key = JSON.stringify([domain, value]);
      const current = facets.get(key);
      if (current) current.count += 1;
      else facets.set(key, { domain, value, count: 1 });
    };
    let total = 0;
    const take = (record: SourceRecord) => {
      total += 1;
      counts[record.sourceType] = (counts[record.sourceType] ?? 0) + 1;
      for (const facet of record.facets) add(facet.domain, facet.value);
      if (record.assigneeEmail)
        add("person", record.assigneeEmail.toLowerCase());
      if (record.sourceAuthorEmail)
        add("person", record.sourceAuthorEmail.toLowerCase());
    };
    if (config.mode === "csv") {
      for (const record of csvRecords(config.csvText, config.baseUrl).records)
        take(record);
    } else {
      const client = clientFor(connection, config, transport);
      for (const project of await listProjects(client, config.project)) {
        const processTemplate = await projectProcess(client, project);
        let last = 0;
        for (;;) {
          const ids = await wiqlIds(client, project, last, SCAN_PAGE);
          if (ids.length === 0) break;
          for (const item of await batchItems(client, project, ids)) {
            const record = toRecord(item, {
              baseUrl: config.baseUrl,
              process: processTemplate,
            });
            if (record) take(record);
          }
          last = ids[ids.length - 1] as number;
          if (ids.length < SCAN_PAGE) break;
        }
      }
    }
    return { facets: [...facets.values()], counts, totalRecords: total };
  }

  return {
    pluginId: "import.azure-devops",
    chunkSize,
    async connect(connection): Promise<ConnectResult> {
      const config = parseConfig(connection);
      if (!config) return { ok: false, reason: "invalid_configuration" };
      if (config.mode === "csv") return { ok: true, label: "csv export" };
      try {
        const client = clientFor(connection, config, transport);
        const projects = await listProjects(client, undefined);
        if (config.project && !projects.includes(config.project))
          return { ok: false, reason: "not_found" };
        return { ok: true, label: new URL(config.baseUrl).pathname.slice(1) };
      } catch (error) {
        return { ok: false, reason: failureReason(error) };
      }
    },
    attachmentAuth(connection): ImportAttachmentAuth | null {
      const config = parseConfig(connection);
      if (!config || config.mode !== "rest" || !connection.credential)
        return null;
      return {
        headers: {
          authorization: `Basic ${Buffer.from(`:${connection.credential}`, "utf8").toString("base64")}`,
        },
        hosts: [new URL(config.baseUrl).hostname],
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
          // `Resolved` (and any unknown or custom state) yields no proposal: it stays unmapped and
          // blocks the run until a person chooses, so a one-click confirm-all cannot decide it.
          const group = proposeStateGroup(facet.value);
          if (group)
            proposals.push({
              domain: "state",
              value: facet.value,
              target: { kind: "group", group },
              confidence: "heuristic",
            });
        } else if (facet.domain === "priority") {
          const value = ADO_PRIORITY[facet.value];
          if (value)
            proposals.push({
              domain: "priority",
              value: facet.value,
              target: { kind: "priority", value },
              confidence: "exact",
            });
        } else if (facet.domain === "type") {
          const key = slug(facet.value);
          const direct =
            context.typeIdsByKey.get(facet.value) ??
            context.typeIdsByKey.get(key);
          const alias = TYPE_ALIASES[key];
          const id =
            direct ?? (alias ? context.typeIdsByKey.get(alias) : undefined);
          if (id)
            proposals.push({
              domain: "type",
              value: facet.value,
              target: { kind: "target", id },
              confidence: direct ? "exact" : "heuristic",
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
        // module (area path), cycle (iteration path), label and custom_field have no destination
        // ids in the proposal context, so they stay unmapped for the operator.
      }
      return proposals;
    },
    async readPage(connection, cursor, pageSize): Promise<SourcePage> {
      const config = parseConfig(connection);
      if (!config) throw new SourceHttpError("config_invalid");
      const size = Math.max(1, Math.min(pageSize, chunkSize, MAX_PAGE));
      if (config.mode === "csv") {
        const all = csvRecords(config.csvText, config.baseUrl).records;
        const start = cursor === null ? 0 : Number(cursor);
        const from = Number.isInteger(start) && start >= 0 ? start : 0;
        const end = Math.min(from + size, all.length);
        return {
          records: all.slice(from, end),
          nextCursor: end < all.length ? String(end) : null,
        };
      }
      const client = clientFor(connection, config, transport);
      const projects = await listProjects(client, config.project);
      let { p, last } = parseCursor(cursor);
      while (p < projects.length) {
        const project = projects[p] as string;
        // One extra id tells whether the project has more, so the last page never leaves an
        // empty trailing chunk behind.
        const fetched = await wiqlIds(client, project, last, size + 1);
        const ids = fetched.slice(0, size);
        if (ids.length === 0) {
          p += 1;
          last = 0;
          continue;
        }
        const processTemplate = await projectProcess(client, project);
        const records: SourceRecord[] = [];
        for (const item of await batchItems(client, project, ids)) {
          const id = num(item.id);
          if (id === undefined) continue;
          const record = toRecord(item, {
            baseUrl: config.baseUrl,
            process: processTemplate,
            comments: await itemComments(client, project, id),
            updates: await itemUpdates(client, project, id),
          });
          if (record) records.push(record);
        }
        const lastId = ids[ids.length - 1] as number;
        const nextCursor =
          fetched.length > size
            ? `${p}:${lastId}`
            : p + 1 < projects.length
              ? `${p + 1}:0`
              : null;
        return { records, nextCursor };
      }
      return { records: [], nextCursor: null };
    },
  };
}

export function registerAzureDevOpsAdapter(
  options: AzureDevOpsAdapterOptions = {},
) {
  registerImportAdapter("import.azure-devops", () =>
    createAzureDevOpsAdapter(options),
  );
}

/**
 * Jira / Jira Service Management import adapter (P6 lane C2).
 *
 * One core, two plugin ids (`import.jira`, `import.jsm`; JSM adds the service-desk flavour from
 * `../jsm`). Two access modes, chosen by the connection config:
 *
 *   export  `config.export` (the issues JSON, size-limited) or `config.exportFile` (a stored file
 *           resolved by an injected loader). Fully offline.
 *   rest    `config.baseUrl` + `config.projectKey` (+ optional `config.jqlFilter`), credential
 *           `email:token`. Jira Cloud API v3 enhanced search, cursor = `nextPageToken`, read-only,
 *           rate-limit aware, through the guarded egress in `client.ts`.
 *
 * The adapter never writes to the source and never returns or logs a credential.
 */
import type { ImportPluginId } from "../../../database/schema-imports";
import type {
  AdapterConnection,
  ConnectFailureReason,
  ConnectResult,
  DiscoveredFacet,
  DiscoveryResult,
  ImportAttachmentAuth,
  ImportSourceAdapter,
  ProposalContext,
  ProposedMapping,
  SourcePage,
} from "../../engine/adapter";
import { jsmFlavor } from "../jsm";
import {
  createGuardedJiraTransport,
  JiraClient,
  type JiraTransport,
  parseBaseUrl,
  parseCredential,
  type Sleep,
} from "./client";
import {
  JiraSourceError,
  MAX_INLINE_EXPORT_BYTES,
  parseExport,
} from "./export-source";
import {
  asObject,
  asString,
  type FieldMap,
  type NormalizedIssue,
  normalizeIssue,
  type Raw,
} from "./normalize";
import { proposeAll } from "./proposals";

export const JIRA_CHUNK_SIZE = 100;
const MAX_REST_PAGES = 2000;
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{1,31}$/u;

export type JiraAdapterDeps = {
  /** GET-only transport; defaults to the guarded egress. Tests inject recorded fixtures. */
  transport?: JiraTransport;
  sleep?: Sleep;
  /** Resolves `config.exportFile` to the parsed export JSON, or null when unavailable. */
  loadExportFile?: (ref: string) => Promise<unknown | null>;
  /** Page size the engine reads with (1..100). Defaults to `JIRA_CHUNK_SIZE`. */
  chunkSize?: number;
};

type ExportMode = {
  kind: "export";
  inline?: unknown;
  fileRef?: string;
  siteUrl?: string;
};
type RestMode = {
  kind: "rest";
  baseUrl: URL;
  siteUrl: string;
  projectKey: string;
  jqlFilter?: string;
};
type Mode = ExportMode | RestMode;

function configuredSiteUrl(config: Record<string, unknown>) {
  const url = parseBaseUrl(config.siteUrl);
  return url ? url.origin : undefined;
}

function readMode(config: Record<string, unknown>): Mode {
  const wantsRest =
    config.mode === "rest" ||
    (config.mode === undefined &&
      config.baseUrl !== undefined &&
      config.export === undefined &&
      config.exportText === undefined &&
      config.exportFile === undefined);
  if (!wantsRest) {
    // Inline export text (the wizard and engine route: no stored-file service exists). Size-limited.
    if (config.exportText !== undefined) {
      const text = asString(config.exportText);
      if (!text) throw new JiraSourceError("jira_export_text_missing");
      if (Buffer.byteLength(text, "utf8") > MAX_INLINE_EXPORT_BYTES)
        throw new JiraSourceError("jira_export_too_large");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new JiraSourceError("jira_export_invalid");
      }
      return {
        kind: "export",
        inline: parsed,
        siteUrl: configuredSiteUrl(config),
      };
    }
    if (config.export !== undefined) {
      const size = JSON.stringify(config.export)?.length ?? 0;
      if (size > MAX_INLINE_EXPORT_BYTES)
        throw new JiraSourceError("jira_export_too_large");
      return {
        kind: "export",
        inline: config.export,
        siteUrl: configuredSiteUrl(config),
      };
    }
    const fileRef = asString(config.exportFile);
    if (fileRef)
      return { kind: "export", fileRef, siteUrl: configuredSiteUrl(config) };
    throw new JiraSourceError("jira_config_invalid");
  }
  const baseUrl = parseBaseUrl(config.baseUrl);
  const projectKey = asString(config.projectKey);
  if (!baseUrl || !projectKey || !PROJECT_KEY.test(projectKey))
    throw new JiraSourceError("jira_config_invalid");
  const jqlFilter = asString(config.jqlFilter);
  if (jqlFilter && (jqlFilter.length > 2000 || /order\s+by/iu.test(jqlFilter)))
    throw new JiraSourceError("jira_config_invalid");
  const siteUrl = configuredSiteUrl(config) ?? baseUrl.origin;
  return { kind: "rest", baseUrl, siteUrl, projectKey, jqlFilter };
}

export function buildJql(mode: RestMode): string {
  const filter = mode.jqlFilter ? ` AND (${mode.jqlFilter})` : "";
  return `project = "${mode.projectKey}"${filter} ORDER BY created ASC, key ASC`;
}

function fieldMapOf(
  config: Record<string, unknown>,
  names: ReadonlyMap<string, string>,
): FieldMap {
  return {
    names,
    epicLinkField: asString(config.epicLinkField),
    startDateField: asString(config.startDateField),
  };
}

function exportSiteUrl(issues: Raw[]): string | undefined {
  for (const issue of issues) {
    const self = asString(issue.self);
    if (!self) continue;
    try {
      const url = new URL(self);
      if (url.protocol === "https:" && !url.username && !url.password)
        return url.origin;
    } catch {
      // try the next issue
    }
  }
  return undefined;
}

function jiraFailureReason(error: unknown): ConnectFailureReason {
  const code = error instanceof JiraSourceError ? error.code : "";
  switch (code) {
    case "jira_unauthorized":
    case "jira_forbidden":
    case "jira_credential_missing":
      return "auth_failed";
    case "jira_not_found":
      return "not_found";
    case "jira_export_too_large":
      return "file_too_large";
    case "jira_export_invalid":
      return "invalid_export";
    case "jira_export_text_missing":
    case "jira_export_unavailable":
      return "export_text_missing";
    case "jira_config_invalid":
      return "invalid_configuration";
    case "jira_destination_refused":
    case "jira_rate_limited":
    case "jira_redirect_refused":
    case "jira_http_error":
    case "jira_invalid_response":
      return "unreachable";
    default:
      return "source_error";
  }
}

export function createJiraAdapter(
  pluginId: ImportPluginId,
  deps: JiraAdapterDeps = {},
): ImportSourceAdapter {
  const flavor = pluginId === "import.jsm" ? jsmFlavor : undefined;
  let defaultTransport: JiraTransport | undefined;
  const transport: JiraTransport = (request) => {
    if (deps.transport) return deps.transport(request);
    defaultTransport ??= createGuardedJiraTransport();
    return defaultTransport(request);
  };

  function clientFor(mode: RestMode, connection: AdapterConnection) {
    const credentials = parseCredential(
      connection.credential,
      connection.config.email,
    );
    if (!credentials) throw new JiraSourceError("jira_credential_missing");
    return new JiraClient({
      baseUrl: mode.baseUrl,
      credentials,
      transport,
      sleep: deps.sleep,
    });
  }

  async function loadExport(mode: ExportMode) {
    let root: unknown = mode.inline;
    if (mode.fileRef !== undefined) {
      root = (await deps.loadExportFile?.(mode.fileRef)) ?? null;
      if (root === null) throw new JiraSourceError("jira_export_unavailable");
    }
    return parseExport(root);
  }

  function normalizeAll(
    issues: Raw[],
    fieldMap: FieldMap,
    siteUrl: string | undefined,
    collapsed?: Set<string>,
  ): NormalizedIssue[] {
    return issues.map((issue) => {
      const normalized = normalizeIssue(issue, { fieldMap, siteUrl, flavor });
      if (collapsed?.has(normalized.key)) {
        const losses = normalized.record.losses ?? [];
        losses.push({ code: "duplicate_row_collapsed" });
        normalized.record.losses = losses;
      }
      return normalized;
    });
  }

  function aggregate(all: NormalizedIssue[]): DiscoveryResult {
    const facets = new Map<string, DiscoveredFacet>();
    const add = (
      seen: Set<string>,
      domain: DiscoveredFacet["domain"],
      value: string,
      label?: string,
    ) => {
      const key = JSON.stringify([domain, value]);
      if (seen.has(key)) return;
      seen.add(key);
      const current = facets.get(key);
      if (current) {
        current.count += 1;
        if (label && !current.label) current.label = label;
      } else
        facets.set(key, {
          domain,
          value,
          count: 1,
          ...(label ? { label } : {}),
        });
    };
    for (const issue of all) {
      const seen = new Set<string>();
      const labels = new Map(
        issue.facetLabels.map((l) => [
          JSON.stringify([l.domain, l.value]),
          l.label,
        ]),
      );
      for (const facet of issue.record.facets)
        add(
          seen,
          facet.domain,
          facet.value,
          labels.get(JSON.stringify([facet.domain, facet.value])),
        );
      if (issue.record.assigneeEmail)
        add(seen, "person", issue.record.assigneeEmail);
      if (issue.record.sourceAuthorEmail)
        add(seen, "person", issue.record.sourceAuthorEmail);
    }
    return {
      facets: [...facets.values()],
      counts: { issue: all.length },
      totalRecords: all.length,
    };
  }

  async function restPage(
    client: JiraClient,
    mode: RestMode,
    config: Record<string, unknown>,
    cursor: string | null,
    pageSize: number,
  ): Promise<{ issues: NormalizedIssue[]; next: string | null }> {
    const body = asObject(
      await client.getJson("/rest/api/3/search/jql", {
        jql: buildJql(mode),
        maxResults: String(Math.max(1, Math.min(pageSize, JIRA_CHUNK_SIZE))),
        fields: "*all",
        expand: "names,changelog",
        nextPageToken: cursor ?? undefined,
      }),
    );
    if (!body || !Array.isArray(body.issues))
      throw new JiraSourceError("jira_invalid_response");
    const names = new Map<string, string>();
    for (const [id, name] of Object.entries(asObject(body.names) ?? {})) {
      const text = asString(name);
      if (text) names.set(id, text);
    }
    const rows = body.issues.map(asObject);
    if (rows.some((row) => !row || !asString(row.key) || !asObject(row.fields)))
      throw new JiraSourceError("jira_invalid_response");
    const issues = normalizeAll(
      rows as Raw[],
      fieldMapOf(config, names),
      mode.siteUrl,
    );
    const token = asString(body.nextPageToken);
    const last = body.isLast === true || !token || rows.length === 0;
    return { issues, next: last ? null : (token ?? null) };
  }

  return {
    pluginId,
    chunkSize: Math.max(
      1,
      Math.min(deps.chunkSize ?? JIRA_CHUNK_SIZE, JIRA_CHUNK_SIZE),
    ),

    async connect(connection): Promise<ConnectResult> {
      try {
        const mode = readMode(connection.config);
        if (mode.kind === "export") {
          const parsed = await loadExport(mode);
          return { ok: true, label: `export (${parsed.issues.length})` };
        }
        const client = clientFor(mode, connection);
        const me = asObject(await client.getJson("/rest/api/3/myself"));
        if (!me || !asString(me.accountId))
          return { ok: false, reason: "auth_failed" };
        return { ok: true, label: mode.baseUrl.hostname };
      } catch (error) {
        return { ok: false, reason: jiraFailureReason(error) };
      }
    },

    attachmentAuth(connection): ImportAttachmentAuth | null {
      // Credentials go only to the configured Jira host. Jira Cloud answers attachment content with a
      // redirect to its media host; redirects to another host are never followed (SSRF policy), so
      // those attachments are reported as `attachment_download_failed` with their source URL.
      try {
        const mode = readMode(connection.config);
        if (mode.kind !== "rest") return null;
        const credentials = parseCredential(
          connection.credential,
          connection.config.email,
        );
        if (!credentials) return null;
        return {
          headers: {
            authorization: `Basic ${Buffer.from(
              `${credentials.email}:${credentials.token}`,
            ).toString("base64")}`,
          },
          hosts: [mode.baseUrl.hostname],
        };
      } catch {
        return null;
      }
    },

    async discover(connection): Promise<DiscoveryResult> {
      const mode = readMode(connection.config);
      if (mode.kind === "export") {
        const parsed = await loadExport(mode);
        return aggregate(
          normalizeAll(
            parsed.issues,
            fieldMapOf(connection.config, parsed.names),
            mode.siteUrl ?? exportSiteUrl(parsed.issues),
            parsed.collapsed,
          ),
        );
      }
      const client = clientFor(mode, connection);
      const all: NormalizedIssue[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < MAX_REST_PAGES; pages += 1) {
        const page = await restPage(
          client,
          mode,
          connection.config,
          cursor,
          JIRA_CHUNK_SIZE,
        );
        all.push(...page.issues);
        cursor = page.next;
        if (cursor === null) return aggregate(all);
      }
      throw new JiraSourceError("jira_source_too_large");
    },

    async proposeMapping(
      discovery: DiscoveryResult,
      context: ProposalContext,
    ): Promise<ProposedMapping[]> {
      return proposeAll(discovery.facets, context);
    },

    async readPage(connection, cursor, pageSize): Promise<SourcePage> {
      const mode = readMode(connection.config);
      if (mode.kind === "rest") {
        const client = clientFor(mode, connection);
        const page = await restPage(
          client,
          mode,
          connection.config,
          cursor,
          pageSize,
        );
        return {
          records: page.issues.map((issue) => issue.record),
          nextCursor: page.next,
        };
      }
      const parsed = await loadExport(mode);
      const start = cursor === null ? 0 : Number(cursor);
      if (!Number.isInteger(start) || start < 0 || start > parsed.issues.length)
        throw new JiraSourceError("jira_cursor_invalid");
      const end = Math.min(start + pageSize, parsed.issues.length);
      const slice = parsed.issues.slice(start, end);
      const normalized = normalizeAll(
        slice,
        fieldMapOf(connection.config, parsed.names),
        mode.siteUrl ?? exportSiteUrl(parsed.issues),
        parsed.collapsed,
      );
      return {
        records: normalized.map((issue) => issue.record),
        nextCursor: end < parsed.issues.length ? String(end) : null,
      };
    },
  };
}

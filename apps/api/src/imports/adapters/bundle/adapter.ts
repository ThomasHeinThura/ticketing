/**
 * TaskDesk import bundle adapter (`import.bundle`).
 *
 * The source is an NDJSON bundle (`./schema`) carried inline in
 * `config.bundleText` (at most 8 MB), plus `config.projectKey` to pick one project of a multi-project
 * file (optional when the file holds exactly one). A run is bound to one destination project, so a
 * multi-project bundle needs one run per project key.
 *
 * Read-only and offline: no network, no credential. `readPage` is a pure function of
 * (bundleText, projectKey, cursor); the cursor is the zero-based index into the project's items in
 * file order, so a resume after a crash returns exactly the same records.
 *
 * What is NOT written, and how it is reported (nothing is silent):
 *   requester            -> the engine's `writer_unavailable` / `requester` loss
 *   estimate, cycle,
 *   modules, links       -> `estimate_not_carried`, `cycle_not_carried`, `module_not_carried`,
 *                           `links_not_carried` per record
 *   a person with no
 *   email                -> `person_email_missing` per record (the name is still used)
 *   project, state and
 *   label definitions,
 *   memberships          -> counts in the discovery result (`*_not_written`); slice 1 creates none
 */

import type {
  AdapterConnection,
  ConnectResult,
  DiscoveredFacet,
  DiscoveryResult,
  ImportSourceAdapter,
  LossInput,
  ProposalContext,
  ProposedMapping,
  SourceFacet,
  SourcePage,
  SourceRecord,
  StateGroup,
} from "../../engine/adapter";
import { STATE_GROUPS } from "../../engine/adapter";
import { BundleSourceError, type BundleView, readBundle } from "./parse";
import type { BundleItem, BundlePerson, BundleState } from "./schema";

export const BUNDLE_CHUNK_SIZE = 100;

const stateFacetValue = (state: BundleState) =>
  `${state.name} (${state.group})`;

function groupOfStateFacet(value: string): StateGroup | null {
  const group = /\((\w+)\)$/u.exec(value)?.[1];
  return group && (STATE_GROUPS as readonly string[]).includes(group)
    ? (group as StateGroup)
    : null;
}

function toRecord(item: BundleItem, view: BundleView): SourceRecord {
  const { bundle } = view;
  const losses: LossInput[] = [];
  const addLoss = (code: string, detailCode?: string) => {
    if (!losses.some((l) => l.code === code && l.detailCode === detailCode))
      losses.push(detailCode ? { code, detailCode } : { code });
  };
  /** Email and name of a referenced person; an email-less person is reported, never guessed. */
  const who = (ref: string | undefined, detail: string) => {
    const person: BundlePerson | undefined = ref
      ? bundle.people.get(ref)
      : undefined;
    if (person && !person.email) addLoss("person_email_missing", detail);
    return {
      ...(person?.email ? { email: person.email } : {}),
      ...(person?.name ? { name: person.name } : {}),
    };
  };
  const nested = (ref: string | undefined, detail: string) => {
    const p = who(ref, detail);
    return {
      ...(p.email ? { authorEmail: p.email } : {}),
      ...(p.name ? { authorName: p.name } : {}),
    };
  };

  const state = bundle.states.get(item.state);
  const facets: SourceFacet[] = [
    { domain: "type", value: item.type ?? "task" },
    ...(state
      ? [{ domain: "state" as const, value: stateFacetValue(state) }]
      : []),
    ...(item.priority
      ? [{ domain: "priority" as const, value: item.priority }]
      : []),
    ...[...new Set(item.labels ?? [])].flatMap((id) => {
      const name = bundle.labels.get(id)?.name;
      return name ? [{ domain: "label" as const, value: name }] : [];
    }),
  ];

  const assignee = who(item.assignee, "assignee");
  const author = who(item.createdBy, "author");
  const requester = who(item.requester, "requester");

  if (item.estimate !== undefined) addLoss("estimate_not_carried");
  if (item.cycle !== undefined) addLoss("cycle_not_carried");
  if (item.modules?.length) addLoss("module_not_carried");
  if (item.links?.length) addLoss("links_not_carried");

  const comments = item.comments?.map((c) => ({
    sourceId: c.id,
    ...nested(c.author, "comment"),
    ...(c.createdAt ? { createdAt: c.createdAt } : {}),
    ...(c.updatedAt ? { updatedAt: c.updatedAt } : {}),
    // The bundle may say; absent means internal, the writer's safe default.
    ...(c.visibility ? { visibility: c.visibility } : {}),
    body: c.body,
  }));
  const attachments = item.attachments?.map((a) => ({
    sourceId: a.id,
    url: a.url,
    filename: a.filename,
    ...(a.mimeType ? { mimeType: a.mimeType } : {}),
    ...(a.size !== undefined ? { size: a.size } : {}),
    ...nested(a.author, "attachment"),
    ...(a.createdAt ? { createdAt: a.createdAt } : {}),
  }));
  const history = item.history?.map((h) => ({
    sourceId: h.id,
    at: h.at,
    ...nested(h.author, "history"),
    field: h.field,
    ...(h.from !== undefined ? { from: h.from } : {}),
    ...(h.to !== undefined ? { to: h.to } : {}),
  }));
  const relations = item.relations?.map((r) => ({
    type: r.type,
    target: { sourceType: "issue", sourceId: r.target },
  }));

  return {
    sourceType: "issue",
    sourceId: item.id,
    ...(item.url ? { sourceUrl: item.url } : {}),
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.startDate ? { startDate: item.startDate } : {}),
    ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    ...(item.createdAt ? { sourceCreatedAt: item.createdAt } : {}),
    ...(item.updatedAt ? { sourceUpdatedAt: item.updatedAt } : {}),
    ...(item.resolvedAt ? { sourceResolvedAt: item.resolvedAt } : {}),
    ...(author.email ? { sourceAuthorEmail: author.email } : {}),
    ...(author.name ? { sourceAuthorName: author.name } : {}),
    ...(item.requester && (requester.email || requester.name)
      ? { requester }
      : {}),
    ...(assignee.email ? { assigneeEmail: assignee.email } : {}),
    ...(item.parent ? { parentSourceId: item.parent } : {}),
    facets,
    ...(comments?.length ? { comments } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(relations?.length ? { relations } : {}),
    ...(history?.length ? { history } : {}),
    ...(losses.length ? { losses } : {}),
  };
}

function discoverView(view: BundleView): DiscoveryResult {
  const facets = new Map<string, DiscoveredFacet>();
  for (const item of view.items) {
    const record = toRecord(item, view);
    const seen = new Set<string>();
    const add = (domain: DiscoveredFacet["domain"], value: string) => {
      const key = JSON.stringify([domain, value]);
      if (seen.has(key)) return;
      seen.add(key);
      const current = facets.get(key);
      if (current) current.count += 1;
      else facets.set(key, { domain, value, count: 1 });
    };
    for (const facet of record.facets) add(facet.domain, facet.value);
    if (record.assigneeEmail) add("person", record.assigneeEmail);
    if (record.sourceAuthorEmail) add("person", record.sourceAuthorEmail);
  }
  const { bundle, project } = view;
  const own = <T extends { project: string }>(rows: Iterable<T>) =>
    [...rows].filter((row) => row.project === project.id).length;
  return {
    facets: [...facets.values()],
    counts: {
      issue: view.items.length,
      // Declared in the bundle, not written by this slice (reported, never silent).
      membership_not_written: own(bundle.memberships),
      state_not_written: own(bundle.states.values()),
      label_not_written: own(bundle.labels.values()),
      // Converter warnings from the file header (unsupported endpoints, truncated lists).
      ...(bundle.header?.warnings?.length
        ? { converter_warnings: bundle.header.warnings.length }
        : {}),
    },
    totalRecords: view.items.length,
  };
}

export function createBundleAdapter(
  chunkSize: number = BUNDLE_CHUNK_SIZE,
): ImportSourceAdapter {
  return {
    pluginId: "import.bundle",
    chunkSize: Math.max(1, Math.min(chunkSize, BUNDLE_CHUNK_SIZE)),

    async connect(connection: AdapterConnection): Promise<ConnectResult> {
      try {
        const view = readBundle(connection.config);
        return {
          ok: true,
          label: `bundle ${view.project.key} (${view.items.length})`,
        };
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof BundleSourceError ? error.reason : "source_error",
        };
      }
    },

    // The canonical project key (as written in the file, however the client spelled it, or the sole
    // project when none was given) is stored at creation; a client-supplied value is overwritten.
    normalizeConfig(config) {
      const { scopeProjectKey: _client, ...rest } = config;
      try {
        return { ...rest, scopeProjectKey: readBundle(config).project.key };
      } catch {
        return rest;
      }
    },

    // One sourceRef per bundle source (relations resolve across projects); the stale sweep is per
    // project, matched on the canonical key only. A source created before it existed has none: the
    // empty value matches no run, so such a run never marks anything stale and is never marked.
    staleScope(connection) {
      const key = connection.config.scopeProjectKey;
      return { scopeProjectKey: typeof key === "string" ? key : "" };
    },

    async discover(connection): Promise<DiscoveryResult> {
      return discoverView(readBundle(connection.config));
    },

    // Proposals only for exact matches; everything else stays unmapped and blocks execute (IM-4).
    async proposeMapping(
      discovery: DiscoveryResult,
      context: ProposalContext,
    ): Promise<ProposedMapping[]> {
      const proposals: ProposedMapping[] = [];
      for (const facet of discovery.facets) {
        if (facet.domain === "state") {
          const group = groupOfStateFacet(facet.value);
          if (group)
            proposals.push({
              domain: "state",
              value: facet.value,
              target: { kind: "group", group },
              confidence: "exact",
            });
        } else if (facet.domain === "priority") {
          if (["low", "medium", "high", "urgent"].includes(facet.value))
            proposals.push({
              domain: "priority",
              value: facet.value,
              target: {
                kind: "priority",
                value: facet.value as "low" | "medium" | "high" | "urgent",
              },
              confidence: "exact",
            });
        } else if (facet.domain === "type") {
          const exact = context.typeIdsByKey.get(facet.value);
          const id =
            exact ?? context.typeIdsByKey.get(facet.value.toLowerCase());
          if (id)
            proposals.push({
              domain: "type",
              value: facet.value,
              target: { kind: "target", id },
              confidence: exact ? "exact" : "heuristic",
            });
        } else if (facet.domain === "person") {
          const id = context.peopleByEmail.get(facet.value.toLowerCase());
          if (id)
            proposals.push({
              domain: "person",
              value: facet.value,
              target: { kind: "target", id },
              confidence: "exact",
            });
        }
        // label: the proposal context carries no destination labels, so labels stay unmapped.
      }
      return proposals;
    },

    async readPage(connection, cursor, pageSize): Promise<SourcePage> {
      const view = readBundle(connection.config);
      const start = cursor === null ? 0 : Number(cursor);
      if (!Number.isInteger(start) || start < 0 || start > view.items.length)
        throw new BundleSourceError("source_error");
      const end = Math.min(start + Math.max(pageSize, 1), view.items.length);
      return {
        records: view.items
          .slice(start, end)
          .map((item) => toRecord(item, view)),
        nextCursor: end < view.items.length ? String(end) : null,
      };
    },
  };
}

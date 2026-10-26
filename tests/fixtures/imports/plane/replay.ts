/**
 * Replays recorded Plane response bodies (the JSON files beside this one) as a transport. Only GET
 * is answered; anything else, or an unrecorded path, throws. List endpoints are paginated the way
 * Plane does it (`per_page`, opaque `per:page:0` cursors, `next_page_results`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SourceHttpRequest,
  SourceHttpResponse,
  SourceTransport,
} from "../../../../apps/api/src/imports/adapters/azure-devops/http";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as T;

export const PLANE_FIXTURE_KEY = "plane-fixture-key-0000";
export const PLANE_API = "https://api.plane.so";
export const PLANE_PROJECTS = [
  { identifier: "ENG", name: "Engineering" },
  { identifier: "MKT", name: "Marketing" },
  { identifier: "OPS", name: "Operations" },
] as const;

type Row = Record<string, unknown>;
export const planeIssues = (identifier: string): Row[] =>
  read<Row[]>(`${identifier}-issues.json`);
export const planeStates = (identifier: string): Row[] =>
  read<Row[]>(`${identifier}-states.json`);
export const planeTypes = (identifier: string): Row[] =>
  read<Row[]>(`${identifier}-issue-types.json`);
export const planeMembers = () => read<Row[]>("members.json");
export const planeProjects = () =>
  read<{ results: Row[] }>("projects.json").results;

export type PlaneReplay = {
  transport: SourceTransport;
  requests: Array<{ method: string; path: string }>;
};

function paginate(rows: Row[], url: URL): SourceHttpResponse {
  const per = Number(url.searchParams.get("per_page") ?? 100);
  const cursor = url.searchParams.get("cursor");
  const page = cursor ? Number(cursor.split(":")[1]) : 0;
  const slice = rows.slice(page * per, page * per + per);
  const more = (page + 1) * per < rows.length;
  return {
    status: 200,
    json: {
      grouped_by: null,
      sub_grouped_by: null,
      total_count: rows.length,
      next_cursor: more ? `${per}:${page + 1}:0` : `${per}:${page}:0`,
      prev_cursor: `${per}:${page - 1}:1`,
      next_page_results: more,
      prev_page_results: page > 0,
      count: slice.length,
      total_pages: Math.ceil(rows.length / per),
      total_results: rows.length,
      extra_stats: null,
      results: slice,
    },
  };
}

export function createPlaneReplay(options: { key?: string } = {}): PlaneReplay {
  const key = options.key ?? PLANE_FIXTURE_KEY;
  const projects = planeProjects();
  const byId = new Map(
    projects.map((p) => [p.id as string, p.identifier as string]),
  );
  const comments = read<Record<string, Row[]>>("comments.json");
  const attachments = read<Record<string, Row[]>>("attachments.json");
  const relations = read<Record<string, Row>>("relations.json");
  const activities = read<Record<string, Row[]>>("activities.json");
  const cycleIssues = read<Record<string, Row[]>>("cycle-issues.json");
  const moduleIssues = read<Record<string, Row[]>>("module-issues.json");
  const requests: PlaneReplay["requests"] = [];

  const transport: SourceTransport = async (
    request: SourceHttpRequest,
  ): Promise<SourceHttpResponse> => {
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
    });
    if (request.method !== "GET")
      throw new Error(`unexpected ${request.method} to a read-only source`);
    const url = new URL(request.url);
    if (url.origin !== PLANE_API) throw new Error("unexpected host");
    if (request.headers["x-api-key"] !== key)
      return { status: 401, json: null };
    const rest = /^\/api\/v1\/workspaces\/acme(\/.*)$/u.exec(url.pathname)?.[1];
    if (!rest) return { status: 404, json: null };
    if (rest === "/members/") return { status: 200, json: planeMembers() };
    if (rest === "/projects/") return paginate(planeProjects(), url);
    const scoped = /^\/projects\/([^/]+)\/(.+)$/u.exec(rest);
    const identifier = scoped ? byId.get(scoped[1] as string) : undefined;
    if (scoped && identifier) {
      const tail = scoped[2] as string;
      const file = (suffix: string) =>
        read<Row[]>(`${identifier}-${suffix}.json`);
      if (tail === "states/") return paginate(file("states"), url);
      if (tail === "labels/") return paginate(file("labels"), url);
      if (tail === "issue-types/") return paginate(file("issue-types"), url);
      if (tail === "cycles/") return paginate(file("cycles"), url);
      if (tail === "modules/") return paginate(file("modules"), url);
      if (tail === "pages/") return paginate(file("pages"), url);
      if (tail === "issues/") return paginate(file("issues"), url);
      const cycle = /^cycles\/([^/]+)\/cycle-issues\/$/u.exec(tail);
      if (cycle) return paginate(cycleIssues[cycle[1] as string] ?? [], url);
      const mod = /^modules\/([^/]+)\/module-issues\/$/u.exec(tail);
      if (mod) return paginate(moduleIssues[mod[1] as string] ?? [], url);
      const issue =
        /^issues\/([^/]+)\/(comments|issue-attachments|relations|activities)\/$/u.exec(
          tail,
        );
      if (issue) {
        const id = issue[1] as string;
        switch (issue[2]) {
          case "comments":
            return paginate(comments[id] ?? [], url);
          case "issue-attachments":
            return paginate(attachments[id] ?? [], url);
          case "activities":
            return paginate(activities[id] ?? [], url);
          default:
            return { status: 200, json: relations[id] ?? {} };
        }
      }
    }
    throw new Error(`unrecorded request GET ${rest}`);
  };
  return { transport, requests };
}

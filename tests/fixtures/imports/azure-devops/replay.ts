/**
 * Replays recorded Azure DevOps response bodies (the JSON files beside this one) as a transport.
 * It answers only the endpoints the adapter is allowed to use and throws on anything else, so a
 * new or unexpected request fails the test. Every request is recorded for write-safety assertions.
 *
 * WIQL: the recorded `workitems-*.json` files are the server's answer set; the transport evaluates
 * the keyset predicate (`[System.Id] > N`, `$top`) against it, exactly as the server would.
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

export const ADO_FIXTURE_PAT = "ado-fixture-pat-0000";
export const ADO_ORG_URL = "https://dev.azure.com/contoso";
export const ADO_PROJECTS = [
  { name: "Contoso Web", slug: "contoso-web", process: "Agile" },
  { name: "Platform Ops", slug: "platform-ops", process: "Scrum" },
  { name: "Legacy ERP", slug: "legacy-erp", process: "CMMI" },
  { name: "Intranet", slug: "intranet", process: "Basic" },
] as const;

export type AdoFixtureItem = {
  id: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string }>;
};

export const adoItems = (slug: string): AdoFixtureItem[] =>
  read<{ value: AdoFixtureItem[] }>(`workitems-${slug}.json`).value;
export const adoCsvText = () =>
  fs.readFileSync(path.join(dir, "contoso-web-export.csv"), "utf8");

export type AdoReplay = {
  transport: SourceTransport;
  requests: Array<{ method: string; path: string }>;
  authorizations: Set<string>;
};

export function createAdoReplay(options: { pat?: string } = {}): AdoReplay {
  const pat = options.pat ?? ADO_FIXTURE_PAT;
  const projects = ADO_PROJECTS;
  const items = new Map<string, AdoFixtureItem[]>(
    projects.map((p) => [p.name, adoItems(p.slug)]),
  );
  const comments = read<Record<string, unknown>>("comments.json");
  const updates = read<Record<string, { value: unknown[] }>>("updates.json");
  const requests: AdoReplay["requests"] = [];
  const authorizations = new Set<string>();
  const expected = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  const ok = (json: unknown): SourceHttpResponse => ({ status: 200, json });

  const transport: SourceTransport = async (
    request: SourceHttpRequest,
  ): Promise<SourceHttpResponse> => {
    const url = new URL(request.url);
    if (!request.url.startsWith(`${ADO_ORG_URL}/`))
      throw new Error(`unexpected host ${url.origin}`);
    const rest = decodeURIComponent(url.pathname.slice("/contoso".length));
    requests.push({ method: request.method, path: rest });
    const auth = request.headers.authorization ?? "";
    authorizations.add(auth);
    if (auth !== expected) return { status: 401, json: null };

    if (request.method === "GET") {
      if (rest === "/_apis/projects") return ok(read("projects.json"));
      const project = /^\/_apis\/projects\/([^/]+)$/u.exec(rest);
      if (project) {
        const found = projects.find((p) => p.name === project[1]);
        if (!found) return { status: 404, json: null };
        return ok(read(`project-${found.slug}.json`));
      }
      const comment = /^\/[^/]+\/_apis\/wit\/workItems\/(\d+)\/comments$/u.exec(
        rest,
      );
      if (comment)
        return ok(
          comments[comment[1] as string] ?? {
            totalCount: 0,
            count: 0,
            comments: [],
          },
        );
      const update = /^\/[^/]+\/_apis\/wit\/workItems\/(\d+)\/updates$/u.exec(
        rest,
      );
      if (update) {
        const all = updates[update[1] as string]?.value ?? [];
        const skip = Number(url.searchParams.get("$skip") ?? 0);
        const top = Number(url.searchParams.get("$top") ?? 200);
        return ok({ count: all.length, value: all.slice(skip, skip + top) });
      }
    } else if (request.method === "POST") {
      const wiql = /^\/([^/]+)\/_apis\/wit\/wiql$/u.exec(rest);
      if (wiql) {
        const query = String((request.body as { query?: string }).query);
        const match =
          /\[System\.TeamProject\] = '((?:[^']|'')*)' AND \[System\.Id\] > (\d+) ORDER BY \[System\.Id\] ASC$/u.exec(
            query,
          );
        if (!match) throw new Error("unexpected WIQL");
        const name = (match[1] as string).replace(/''/gu, "'");
        const last = Number(match[2]);
        const top = Number(url.searchParams.get("$top") ?? 20000);
        const rows = (items.get(name) ?? [])
          .filter((item) => item.id > last)
          .sort((a, b) => a.id - b.id)
          .slice(0, top);
        return ok({
          queryType: "flat",
          workItems: rows.map((item) => ({
            id: item.id,
            url: `${ADO_ORG_URL}/_apis/wit/workItems/${item.id}`,
          })),
        });
      }
      const batch = /^\/([^/]+)\/_apis\/wit\/workitemsbatch$/u.exec(rest);
      if (batch) {
        const ids = (request.body as { ids: number[] }).ids;
        const pool = items.get(batch[1] as string) ?? [];
        const value = ids.flatMap((id) =>
          pool.filter((item) => item.id === id),
        );
        return ok({ count: value.length, value });
      }
    }
    throw new Error(`unrecorded request ${request.method} ${rest}`);
  };
  return { transport, requests, authorizations };
}

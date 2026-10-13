import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  defaultParseSearch,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  createRouterParseSearch,
  isProjectViewPathname,
  parseProjectBoardSearch,
} from "./project-board-search";
import {
  parseGodModeUsersSearch,
  parseIntakeSearch,
  parsePendingActionsSearch,
  parsePortalCatalogueSearch,
  parsePortalSignInSearch,
  parseRequestTypeEditorSearch,
  parseWorkItemDetailSearch,
  parseWorkItemListSearch,
  routes,
} from "./routes";

// Guard for the router-wide `parseSearch` installed by main.tsx. Project view routes get
// a string-preserving codec; every other route must keep exactly the search typing that
// TanStack's default codec gave it.
type Case = {
  name: string;
  pathname: string;
  validate: (raw: unknown) => unknown;
  urls: string[];
};

const hostile = [
  "123",
  "007",
  "true",
  "false",
  "null",
  "1e3",
  "[1]",
  '{"a":1}',
];
const keys = [
  "q",
  "sort",
  "dir",
  "layout",
  "cursor",
  "state",
  "ref",
  "key",
  "side",
  "active",
  "user",
  "action",
  "organisationId",
  "activity",
  "requestTypeId",
  "stage",
  "factor",
  "month",
  "taskId",
  "status",
  "priority",
];
const hostileUrls = keys.flatMap((key) =>
  hostile.map((value) => `?${key}=${encodeURIComponent(value)}`),
);

const cases: Case[] = [
  {
    name: "God Mode Users",
    pathname: routes.godModeUsers.path,
    validate: parseGodModeUsersSearch,
    urls: [
      routes.godModeUsers.build(),
      routes.godModeUsers.build({
        q: "ada",
        side: "staff",
        active: "true",
        organisationId: "org-1",
        cursor: "c1",
        user: "u1",
        action: "suspend",
      }),
      "?q=123&side=staff&active=true",
    ],
  },
  {
    name: "pending actions",
    pathname: routes.pendingActions.path,
    validate: parsePendingActionsSearch,
    urls: [
      routes.pendingActions.build(),
      routes.pendingActions.build({ cursor: "abc" }),
      "?cursor=123",
    ],
  },
  {
    name: "intake queue",
    pathname: routes.intakeQueue.path,
    validate: parseIntakeSearch,
    urls: [
      routes.intakeQueue.build(),
      routes.intakeQueue.build({
        state: "accepted",
        ref: "SUB-12",
        cursor: "c",
      }),
      "?state=declined&ref=SUB-7",
    ],
  },
  {
    name: "portal catalogue",
    pathname: routes.portalCatalogue.path,
    validate: parsePortalCatalogueSearch,
    urls: [
      routes.portalCatalogue.build(),
      routes.portalCatalogue.build({ q: "vpn", key: "k" }),
      "?q=123&key=true",
    ],
  },
  {
    name: "portal sign-in",
    pathname: routes.portalSignIn.path,
    validate: parsePortalSignInSearch,
    urls: [
      routes.portalSignIn.build(),
      routes.portalSignIn.build({ stage: "factor", factor: "backup" }),
    ],
  },
  {
    name: "request types",
    pathname: routes.requestTypes.path,
    validate: parseRequestTypeEditorSearch,
    urls: [
      routes.requestTypes.build(),
      routes.requestTypes.build({ requestTypeId: "rt-1" }),
      "?requestTypeId=123",
    ],
  },
  {
    name: "work items list",
    pathname: "/agent/projects/PROJ/work",
    validate: parseWorkItemListSearch,
    urls: [
      routes.workItemList.build({ projectKey: "PROJ" }),
      routes.workItemList.build(
        { projectKey: "PROJ" },
        { sort: "priority", dir: "desc" },
      ),
      "?layout=list&sort=title&dir=desc",
    ],
  },
  {
    name: "work item detail comments activity",
    pathname: "/agent/work-items/PROJ-1",
    validate: parseWorkItemDetailSearch,
    urls: [
      routes.workItemDetail.build({ key: "PROJ-1" }),
      routes.workItemDetail.build({ key: "PROJ-1" }, { activity: "comments" }),
      routes.workItemDetail.build({ key: "PROJ-1" }, { activity: "public" }),
      "?activity=everything",
    ],
  },
];

const queryOf = (url: string) =>
  url.slice(url.indexOf("?") === -1 ? url.length : url.indexOf("?"));

describe("router-wide search codec guard", () => {
  for (const { name, pathname, validate, urls } of cases) {
    describe(name, () => {
      const parse = createRouterParseSearch(() => pathname);

      it("is not a project view route", () => {
        expect(isProjectViewPathname(pathname)).toBe(false);
      });

      it("parses every built and hostile URL exactly like the default codec", () => {
        for (const url of [...urls, ...hostileUrls]) {
          const query = queryOf(url);
          expect(parse(query)).toEqual(defaultParseSearch(query));
          expect(validate(parse(query))).toEqual(
            validate(defaultParseSearch(query)),
          );
        }
      });

      it("round-trips built URLs through a router that uses the codec", async () => {
        for (const url of urls) {
          const history = createMemoryHistory({
            initialEntries: [`${pathname}${queryOf(url)}`],
          });
          const previous = window.location.pathname;
          window.history.replaceState({}, "", pathname);
          try {
            const router = createRouter({
              routeTree: createRootRoute({ validateSearch: validate }),
              history,
              parseSearch: createRouterParseSearch(() => pathname),
            });
            const reference = createRouter({
              routeTree: createRootRoute({ validateSearch: validate }),
              history: createMemoryHistory({
                initialEntries: [`${pathname}${queryOf(url)}`],
              }),
            });
            await router.load();
            await reference.load();
            expect(router.state.location.search).toEqual(
              reference.state.location.search,
            );
          } finally {
            window.history.replaceState({}, "", previous);
          }
        }
      });
    });
  }

  it("keeps numeric-looking text only on the project view routes", () => {
    const projectPath =
      "/dashboard/workspace/workspace-1/project/project-1/board";
    expect(
      parseProjectBoardSearch(
        createRouterParseSearch(() => projectPath)("?q=123&status=true"),
      ),
    ).toEqual({ q: "123", status: ["true"] });
    expect(
      parseGodModeUsersSearch(
        createRouterParseSearch(() => routes.godModeUsers.path)("?q=123"),
      ),
    ).toEqual({});
  });

  it("recognises exactly the four project view routes", () => {
    for (const view of ["backlog", "board", "calendar", "gantt"]) {
      expect(
        isProjectViewPathname(`/dashboard/workspace/w/project/p/${view}`),
      ).toBe(true);
      expect(
        isProjectViewPathname(`/dashboard/workspace/w/project/p/${view}/`),
      ).toBe(true);
    }
    for (const path of [
      undefined,
      "/",
      "/dashboard/workspace/w/project/p",
      "/dashboard/workspace/w/project/p/settings",
      "/dashboard/workspace/w/project/p/board/extra",
      "/agent/projects/PROJ/work",
    ]) {
      expect(isProjectViewPathname(path)).toBe(false);
    }
  });
});

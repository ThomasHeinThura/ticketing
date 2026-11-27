/**
 * A small fake Plane REST API (v1) for tests: `fakePlane({ token })` returns a `fetch` replacement
 * and the list of requests it saw. Two projects, paginated lists, one rate-limited first call.
 */
export function fakePlane({
  token,
  workspace = "acme",
  failPath,
  overrides = {},
} = {}) {
  const requests = [];
  let limited = false;
  const page = (results, next) => ({
    results,
    next_page_results: next !== undefined,
    next_cursor: next ?? "",
  });
  const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  const members = [
    {
      member: {
        id: "u1",
        email: "ana.lopez@example.test",
        display_name: "Ana Lopez",
      },
      role: 20,
    },
    {
      id: "u2",
      email: "ben.ito@example.test",
      display_name: "Ben Ito",
      role: 5,
    },
    { id: "u3", display_name: "Casey No-Email", role: 15 },
  ];
  const issues = {
    p1: [
      {
        id: "w1",
        name: "Fix the login redirect",
        state: "s2",
        priority: "high",
        description_html:
          "<p>Users land on a <strong>blank</strong> page &amp; leave.</p>",
        assignees: ["u1", "u2"],
        created_by: "u2",
        labels: ["l1", "l2"],
        estimate_point: 5,
        created_at: "2026-01-05T09:00:00Z",
        updated_at: "2026-02-01T10:00:00Z",
        start_date: "2026-01-06",
        target_date: "2026-02-15",
      },
      {
        id: "w2",
        name: "Child task",
        state: "s1",
        priority: "none",
        parent: "w1",
        created_by: "u1",
        labels: [],
      },
    ],
    p1b: [
      {
        id: "w3",
        name: "Release notes",
        state: "s3",
        priority: "low",
        completed_at: "2026-03-01T12:00:00Z",
        created_by: "ghost",
      },
    ],
    p2: [
      {
        id: "o1",
        name: "Rotate certificates",
        state: "s4",
        priority: "urgent",
        assignees: ["u3"],
      },
    ],
  };
  const comments = {
    w1: [
      {
        id: "c1",
        actor: "u1",
        comment_html: "<p>Reproduced.</p>",
        created_at: "2026-01-06T11:30:00Z",
      },
      {
        id: "c2",
        actor: "u3",
        comment_stripped: "Same here.",
        created_at: "2026-01-07T08:15:00Z",
      },
    ],
  };

  async function fetchImpl(url, init = {}) {
    const parsed = new URL(url);
    const path =
      parsed.pathname.replace(`/api/v1/workspaces/${workspace}`, "") || "/";
    requests.push({ path, query: parsed.search, init });
    if (init.headers?.["x-api-key"] !== token)
      return json({ detail: "bad key" }, 401);
    if (overrides[path]) return overrides[path]();
    if (failPath && path.startsWith(failPath))
      return json({ detail: "boom" }, 500);
    if (path === "/projects/" && !limited) {
      limited = true;
      return json({}, 429, { "retry-after": "2" });
    }
    const cursor = parsed.searchParams.get("cursor");
    switch (path) {
      case "/members/":
        return json(members);
      case "/projects/":
        return json(
          cursor
            ? page([{ id: "p2", name: "Operations", identifier: "OPS" }])
            : page([{ id: "p1", name: "Web", identifier: "WEB" }], "c2"),
        );
      case "/projects/p1/members/":
        return json(members.slice(0, 2));
      case "/projects/p2/members/":
        return json([]);
      case "/projects/p1/states/":
        return json(
          page([
            { id: "s1", name: "Todo", group: "unstarted" },
            { id: "s2", name: "In Review", group: "started" },
            { id: "s3", name: "Done", group: "completed" },
            { id: "s5", name: "Intake", group: "triage" },
          ]),
        );
      case "/projects/p2/states/":
        return json(page([{ id: "s4", name: "Open", group: "unstarted" }]));
      case "/projects/p1/labels/":
        return json(
          page([
            { id: "l1", name: "bug", color: "#ff0000" },
            { id: "l2", name: "frontend" },
          ]),
        );
      case "/projects/p1/cycles/":
        return json(page([{ id: "cy1", name: "Sprint 4" }]));
      case "/projects/p1/cycles/cy1/cycle-issues/":
        return json(page([{ issue: "w1" }]));
      case "/projects/p1/modules/":
        return json(page([{ id: "m1", name: "Auth" }]));
      case "/projects/p1/modules/m1/module-issues/":
        return json(page([{ issue: "w1" }]));
      case "/projects/p1/issues/":
        return json(cursor ? page(issues.p1b) : page(issues.p1, "i2"));
      case "/projects/p2/issues/":
        return json(page(issues.p2));
      case "/projects/p1/issues/w1/comments/":
        return json(page(comments.w1));
      case "/projects/p1/issues/w1/issue-attachments/":
        return json(
          page([
            {
              id: "a1",
              asset: "/assets/a1.png",
              created_by: "u1",
              created_at: "2026-01-06T11:31:00Z",
              attributes: {
                name: "screen/shot.png",
                size: 1234,
                type: "image/png",
              },
            },
          ]),
        );
      case "/projects/p1/issues/w1/relations/":
        return json({ blocking: ["w2"], relates_to: [{ id: "o1" }] });
      case "/projects/p1/issues/w1/activities/":
        return json(
          page([
            {
              id: "h1",
              field: "state",
              actor: "u1",
              created_at: "2026-01-08T10:00:00Z",
              old_value: "Todo",
              new_value: "In Review",
            },
            {
              id: "h2",
              field: "weird_field",
              actor: "u1",
              created_at: "2026-01-08T10:00:00Z",
            },
          ]),
        );
      default:
        if (/^\/projects\/p2\/(labels|cycles|modules)\/$/u.test(path))
          return json(page([]));
        if (
          /^\/projects\/p\d\/issues\/\w+\/(comments|issue-attachments|activities)\/$/u.test(
            path,
          )
        )
          return json(page([]));
        if (/\/relations\/$/u.test(path)) return json({});
        return json({}, 404);
    }
  }
  return { fetchImpl, requests };
}

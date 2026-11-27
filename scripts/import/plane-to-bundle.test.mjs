import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakePlane } from "./plane-fixture.mjs";
import { ConvertError, htmlToText, main } from "./plane-to-bundle.mjs";

// A fake key built at run time, so no secret-shaped literal sits in the repo.
const TOKEN = ["fake", "plane", "key", "x".repeat(24)].join("-");
const base = ["--base", "https://plane.lan", "--workspace", "acme"];

async function sandbox(fn) {
  const dir = await mkdtemp(join(tmpdir(), "plane-bundle-"));
  try {
    const tokenFile = join(dir, "token");
    await writeFile(tokenFile, `${TOKEN}\n`);
    return await fn({ dir, tokenFile, out: join(dir, "out") });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const sink = () => {
  const chunks = [];
  return { write: (c) => chunks.push(String(c)), text: () => chunks.join("") };
};
const lines = async (file) =>
  (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("writes one self-contained NDJSON per project and people.ndjson", async () => {
  await sandbox(async ({ tokenFile, out }) => {
    const { fetchImpl, requests } = fakePlane({ token: TOKEN });
    const sleeps = [];
    const stdout = sink();
    await main([...base, "--token-file", tokenFile, "--out", out], {
      fetchImpl,
      sleep: async (ms) => sleeps.push(ms),
      stdout,
    });
    assert.deepEqual((await readdir(out)).sort(), [
      "OPS.ndjson",
      "WEB.ndjson",
      "people.ndjson",
    ]);
    // 429 on the first projects call: retried after the server's Retry-After (2 s).
    assert.deepEqual(sleeps, [2000]);
    // Pagination: both project pages and both issue pages were read.
    assert.ok(
      requests.some(
        (r) => r.path === "/projects/" && r.query.includes("cursor=c2"),
      ),
    );
    assert.ok(
      requests.some(
        (r) =>
          r.path === "/projects/p1/issues/" && r.query.includes("cursor=i2"),
      ),
    );
    // GET only, no redirects followed.
    assert.ok(
      requests.every(
        (r) => r.init.method === "GET" && r.init.redirect === "error",
      ),
    );

    const web = await lines(join(out, "WEB.ndjson"));
    assert.equal(web[0].t, "header");
    assert.equal(web[0].bundleVersion, 1);
    assert.equal(web[0].source.instance, "plane.lan");
    const of = (t) => web.filter((l) => l.t === t);
    assert.equal(of("item").length, 3);
    assert.deepEqual(
      of("membership").map((m) => [m.person, m.role, m.sourceRole]),
      [
        ["u1", "lead", "20"],
        ["u2", "viewer", "5"],
      ],
    );
    // A person only seen as an author gets an id-only line so the file is self-contained.
    assert.ok(of("person").some((p) => p.id === "ghost" && !p.email));
    assert.deepEqual(
      of("state").map((s) => s.group),
      ["unstarted", "started", "completed", "backlog"],
    );
    const [w1, w2, w3] = of("item");
    assert.equal(w1.priority, "high");
    assert.equal(w2.priority, "medium"); // Plane "none"
    assert.equal(w3.priority, "low");
    assert.equal(w1.description, "Users land on a blank page & leave.");
    assert.equal(w1.assignee, "u1");
    assert.equal(w1.startDate, "2026-01-06T00:00:00.000Z");
    assert.equal(w1.estimate, 5);
    assert.equal(w1.cycle, "Sprint 4");
    assert.deepEqual(w1.modules, ["Auth"]);
    assert.deepEqual(
      w1.comments.map((c) => [c.id, c.author, c.body, c.visibility]),
      [
        ["c1", "u1", "Reproduced.", "internal"],
        ["c2", "u3", "Same here.", "internal"],
      ],
    );
    assert.equal(w1.attachments[0].filename, "screen_shot.png");
    assert.equal(w1.attachments[0].url, "https://plane.lan/assets/a1.png");
    assert.deepEqual(w1.relations, [
      { type: "blocks", target: "w2" },
      { type: "relates", target: "o1" },
    ]);
    assert.deepEqual(
      w1.history.map((h) => [h.field, h.from, h.to]),
      [["state", "Todo", "In Review"]],
    );
    assert.equal(w2.parent, "w1");

    const summary = JSON.parse(stdout.text());
    assert.deepEqual(
      summary.projects.map((p) => [p.key, p.items]),
      [
        ["OPS", 1],
        ["WEB", 3],
      ],
    );
    assert.equal(summary.skipped.state_group_mapped_to_backlog, 1);
    assert.equal(summary.skipped.history_field_not_carried, 1);
    assert.equal(summary.skipped.extra_assignees_dropped, 1);

    const people = await lines(join(out, "people.ndjson"));
    assert.deepEqual(
      people.map((p) => p.t),
      ["header", "person", "person", "person"],
    );
  });
});

test("--project converts one project and --no-attachments skips the attachment calls", async () => {
  await sandbox(async ({ tokenFile, out }) => {
    const { fetchImpl, requests } = fakePlane({ token: TOKEN });
    await main(
      [
        ...base,
        "--token-file",
        tokenFile,
        "--out",
        out,
        "--project",
        "WEB",
        "--no-attachments",
      ],
      {
        fetchImpl,
        sleep: async () => {},
        stdout: sink(),
      },
    );
    assert.deepEqual((await readdir(out)).sort(), [
      "WEB.ndjson",
      "people.ndjson",
    ]);
    assert.ok(!requests.some((r) => r.path.includes("issue-attachments")));
    const web = await lines(join(out, "WEB.ndjson"));
    assert.equal(web.find((l) => l.id === "w1").attachments, undefined);
  });
});

test("the token never appears in any output file, stdout, request path or error", async () => {
  await sandbox(async ({ dir, tokenFile, out }) => {
    const { fetchImpl, requests } = fakePlane({ token: TOKEN });
    const stdout = sink();
    await main([...base, "--token-file", tokenFile, "--out", out], {
      fetchImpl,
      sleep: async () => {},
      stdout,
    });
    assert.ok(!stdout.text().includes(TOKEN));
    for (const file of await readdir(out))
      assert.ok(
        !(await readFile(join(out, file), "utf8")).includes(TOKEN),
        file,
      );
    for (const r of requests)
      assert.ok(!r.path.includes(TOKEN) && !r.query.includes(TOKEN));
    // The key only ever travels in the header.
    assert.ok(requests.every((r) => r.init.headers["x-api-key"] === TOKEN));

    const failures = [];
    // A server error, a wrong key and a network failure: each message is a status and a path.
    await assert.rejects(
      main([...base, "--token-file", tokenFile, "--out", join(dir, "o2")], {
        fetchImpl: fakePlane({ token: TOKEN, failPath: "/projects/p1/states/" })
          .fetchImpl,
        sleep: async () => {},
        stdout: sink(),
      }),
      (e) => e instanceof ConvertError && failures.push(e.message) > 0,
    );
    const wrong = join(dir, "wrong");
    await writeFile(wrong, "some-other-key-xyz");
    await assert.rejects(
      main([...base, "--token-file", wrong, "--out", join(dir, "o3")], {
        fetchImpl: fakePlane({ token: TOKEN }).fetchImpl,
        sleep: async () => {},
        stdout: sink(),
      }),
      (e) => failures.push(e.message) > 0,
    );
    await assert.rejects(
      main([...base, "--token-file", tokenFile, "--out", join(dir, "o4")], {
        fetchImpl: async () => {
          throw new Error(`connect ECONNREFUSED with header ${TOKEN}`);
        },
        sleep: async () => {},
        stdout: sink(),
      }),
      (e) => failures.push(e.message) > 0,
    );
    assert.deepEqual(failures, [
      "HTTP 500 on /projects/p1/states/",
      "HTTP 401 on /members/",
      "network error on /members/",
    ]);
    for (const message of failures) {
      assert.ok(!message.includes(TOKEN));
      assert.ok(!message.includes("some-other-key-xyz"));
    }
  });
});

test("gives up on a persistent 429 with a status and path", async () => {
  await sandbox(async ({ tokenFile, out }) => {
    let calls = 0;
    await assert.rejects(
      main([...base, "--token-file", tokenFile, "--out", out], {
        fetchImpl: async () => {
          calls += 1;
          return new Response("{}", { status: 429 });
        },
        sleep: async () => {},
        stdout: sink(),
      }),
      /HTTP 429 on \/members\//u,
    );
    assert.equal(calls, 7); // first try + six retries
  });
});

test("refuses plain http, credentials in --base, an empty token file and bad arguments", async () => {
  await sandbox(async ({ dir, tokenFile, out }) => {
    const run = (args) =>
      main(args, {
        fetchImpl: fakePlane({ token: TOKEN }).fetchImpl,
        stdout: sink(),
      });
    await assert.rejects(
      run([
        "--base",
        "http://plane.lan",
        "--workspace",
        "acme",
        "--token-file",
        tokenFile,
        "--out",
        out,
      ]),
      /https/u,
    );
    await assert.rejects(
      run([
        "--base",
        "https://u:p@plane.lan",
        "--workspace",
        "acme",
        "--token-file",
        tokenFile,
        "--out",
        out,
      ]),
      /https/u,
    );
    await assert.rejects(
      run([...base, "--token-file", join(dir, "missing"), "--out", out]),
      /cannot read the token file/u,
    );
    const empty = join(dir, "empty");
    await writeFile(empty, "\n");
    await assert.rejects(
      run([...base, "--token-file", empty, "--out", out]),
      /empty/u,
    );
    await assert.rejects(run([...base, "--out", out]), /Usage/u);
    await assert.rejects(
      run([...base, "--token-file", tokenFile, "--out", out, "--wat"]),
      /unknown option/u,
    );
    await assert.rejects(
      run([
        "--base",
        "https://plane.lan",
        "--workspace",
        "../x",
        "--token-file",
        tokenFile,
        "--out",
        out,
      ]),
      /workspace/u,
    );
  });
});

test("htmlToText decodes entities before stripping tags", () => {
  assert.equal(
    htmlToText("<p>a &lt;script&gt;x&lt;/script&gt;</p><p>b</p>"),
    "a x\nb",
  );
  assert.equal(htmlToText("<ul><li>one</li><li>two</li></ul>"), "- one\n- two");
});

const run = (out, tokenFile, fake) =>
  main([...base, "--token-file", tokenFile, "--out", out, "--project", "WEB"], {
    fetchImpl: fake.fetchImpl,
    sleep: async () => {},
    stdout: sink(),
  });
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
const page = (results) => ({ results, next_page_results: false });

test("a failing endpoint fails the conversion with status and path, never a silent gap", async () => {
  for (const [path, label] of [
    ["/projects/p1/issues/w1/issue-attachments/", "attachments"],
    ["/projects/p1/issues/w1/relations/", "relations"],
    ["/projects/p1/issues/w1/activities/", "history"],
    ["/projects/p1/members/", "memberships"],
    ["/projects/p1/cycles/", "cycles"],
    ["/projects/p1/modules/", "modules"],
  ])
    await sandbox(async ({ tokenFile, out }) => {
      const fake = fakePlane({
        token: TOKEN,
        overrides: { [path]: () => json({}, 500) },
      });
      await assert.rejects(run(out, tokenFile, fake), (e) => {
        assert.equal(e.message, `HTTP 500 on ${path}`, label);
        return true;
      });
      // No half-written bundle is left behind.
      assert.ok(!(await readdir(out)).some((f) => f.startsWith("WEB")), label);
    });
});

test("a 404 on an optional endpoint is reported in the header and the summary", async () => {
  await sandbox(async ({ tokenFile, out }) => {
    const fake = fakePlane({
      token: TOKEN,
      overrides: {
        "/projects/p1/issues/w1/issue-attachments/": () => json({}, 404),
      },
    });
    const stdout = sink();
    await main(
      [...base, "--token-file", tokenFile, "--out", out, "--project", "WEB"],
      {
        fetchImpl: fake.fetchImpl,
        sleep: async () => {},
        stdout,
      },
    );
    const web = await lines(join(out, "WEB.ndjson"));
    assert.equal(web[0].t, "header");
    // The fixture has no issue-types endpoint either (404): both are reported.
    assert.deepEqual(web[0].warnings, [
      { code: "endpoint_not_supported", endpoint: "issue-types" },
      { code: "endpoint_not_supported", endpoint: "issue-attachments" },
    ]);
    assert.deepEqual(
      JSON.parse(stdout.text()).projects[0].warnings,
      web[0].warnings,
    );
    assert.ok(!(await readdir(out)).some((f) => f.endsWith(".body")));
  });
});

test("every truncation is reported with the item and the omitted count", async () => {
  await sandbox(async ({ tokenFile, out }) => {
    const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
    const fake = fakePlane({
      token: TOKEN,
      overrides: {
        "/projects/p1/issues/w1/issue-attachments/": () =>
          json(
            page(
              many(101, (i) => ({
                id: `a${i}`,
                asset: `/assets/${i}.png`,
                attributes: { name: `f${i}.png` },
              })),
            ),
          ),
        "/projects/p1/issues/w1/relations/": () =>
          json({ relates_to: many(203, (i) => `t${i}`) }),
        "/projects/p1/issues/w1/activities/": () =>
          json(
            page(
              many(1002, (i) => ({
                id: `h${i}`,
                field: "state",
                created_at: "2026-01-08T10:00:00Z",
              })),
            ),
          ),
        "/projects/p1/issues/w1/comments/": () =>
          json(
            page(many(503, (i) => ({ id: `c${i}`, comment_stripped: "x" }))),
          ),
      },
    });
    await run(out, tokenFile, fake);
    const [head] = await lines(join(out, "WEB.ndjson"));
    assert.deepEqual(
      head.warnings.filter((w) => w.code.endsWith("_truncated")),
      [
        { code: "comments_truncated", item: "w1", omitted: 3 },
        { code: "attachments_truncated", item: "w1", omitted: 1 },
        { code: "relations_truncated", item: "w1", omitted: 3 },
        { code: "history_truncated", item: "w1", omitted: 2 },
      ],
    );
  });
});

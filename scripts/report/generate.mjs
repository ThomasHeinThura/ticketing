// Generate self-contained docs/report/report.html from docs/report/data.json. Never hand-edit the output.
import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("docs/report/data.json", "utf8"));
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const STATES = [
  ["implemented_tested", "Implemented + current test evidence", "c1"],
  ["browser_verified", "Browser verified", "c7"],
  ["implemented_untested", "Implemented; current verification pending", "c2"],
  ["partial", "Partial / open", "c3"],
  ["missing", "Missing", "c4"],
  ["external_blocked", "Externally blocked", "c5"],
  ["unaudited", "Not audited", "c6"],
];
const count = (p, k) => p.states[k] ?? p[k] ?? 0;

function bar(p, w = 640) {
  const h = 26;
  let x = 0;
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(p.id)} requirement states" class="bar">`;
  for (const [k, label, cls] of STATES) {
    const n = count(p, k);
    if (!n) continue;
    const bw = (n / p.total) * w;
    svg += `<rect x="${x + 1}" y="0" width="${Math.max(bw - 2, 1)}" height="${h}" rx="3" class="${cls}"><title>${esc(label)}: ${n}</title></rect>`;
    if (bw > 28)
      svg += `<text x="${x + bw / 2}" y="17" text-anchor="middle" class="bl">${n}</text>`;
    x += bw;
  }
  return `${svg}</svg>`;
}

const total = data.phases.reduce((a, p) => a + p.total, 0);
const all = {
  id: "ALL",
  total,
  states: Object.fromEntries(
    STATES.map(([k]) => [k, data.phases.reduce((a, p) => a + count(p, k), 0)]),
  ),
};
const legend = STATES.map(
  ([, l, c]) => `<span class="lg"><i class="${c}"></i>${l}</span>`,
).join("");

const verdictClass = (v) =>
  v === "pass" || v === "pass_with_conditions"
    ? "ok"
    : v === "fail"
      ? "bad"
      : "idle";
const verdictLabel = (v) =>
  ({
    pass: "Review passed",
    pass_with_conditions: "Historical review with conditions",
    fail: "Review failed",
    pending: "Fresh review pending",
  })[v] ?? "Not reviewed yet";

const rows = data.phases
  .map((p) => {
    const summary = STATES.map(([k, l]) =>
      count(p, k) ? `${l} ${count(p, k)}` : "",
    )
      .filter(Boolean)
      .join(" · ");
    const gates = p.gates
      ? `Gates: ${esc(p.gates.pass)} pass · ${esc(p.gates.fail)} fail · ${esc(p.gates.not_run)} pending.`
      : "";
    const gateDetails = p.gates?.checks?.length
      ? `<details><summary>Gate results</summary><ul>${p.gates.checks.map((check) => `<li><strong>${esc(check.check)}: ${esc(check.status)}</strong>${check.note ? ` — ${esc(check.note)}` : ""}</li>`).join("")}</ul></details>`
      : "";
    const carry = p.carry?.length
      ? `<details><summary>Open requirement details (${p.carry.length})</summary><ul>${p.carry.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></details>`
      : "";
    return `<section class="card">
<header><h2>${esc(p.id)} · ${esc(p.name)}</h2><span class="pill ${verdictClass(p.review.verdict)}">${verdictLabel(p.review.verdict)}</span></header>
${bar(p)}
<p class="meta">${summary} of ${p.total}</p>
${p.browser ? `<p class="meta">Full browser verification: ${esc(p.browser.verified)} / ${esc(p.total)} requirements.</p>` : ""}
<p class="meta">${gates} Review: ${esc(p.review.roundsConsumed ?? 0)}/${esc(p.review.maxTotalRounds ?? 3)} rounds used · ${esc(p.review.findings ?? 0)} recorded findings.</p>
${p.remaining_summary?.length ? `<h3>Still to finish</h3><ul>${p.remaining_summary.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
${gateDetails}
${carry}
</section>`;
  })
  .join("\n");

const decisions = data.decisions.length
  ? `<section class="card"><details><summary>Decisions and approvals (${data.decisions.length})</summary><ul>${data.decisions.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details></section>`
  : "";
const next = data.next
  ? `<section class="card"><h2>Next</h2><p>${esc(data.next)}</p></section>`
  : "";
const validation = data.validation_runs?.length
  ? `<section class="card"><details><summary>Current validation evidence</summary><ul>${data.validation_runs.map((run) => `<li><strong>${esc(run.check)}:</strong> ${esc(run.result)}</li>`).join("")}</ul></details></section>`
  : "";
const goal = data.p6_goal
  ? `<section class="card"><h2>P6 goal</h2><p>${esc(data.p6_goal.status)}. ${esc(data.p6_goal.target)}</p><ul>${data.p6_goal.goals.map((item) => `<li>${esc(item)}</li>`).join("")}</ul><p>${esc(data.p6_goal.next)}</p></section>`
  : "";
const sharedGaps = data.crosscutting_gaps?.length
  ? `<section class="card"><h2>Shared checks</h2><ul>${data.crosscutting_gaps.map((gap) => `<li><strong>${esc(gap.requirement)}:</strong> ${esc(gap.finding)}</li>`).join("")}</ul></section>`
  : "";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TaskDesk Phase Report</title>
<style>
:root{color-scheme:light;--bg:#fcfcfb;--card:#fff;--ink:#0b0b0b;--ink2:#52514e;--line:#e4e3df;
--c1:#2a78d6;--c2:#1baf7a;--c3:#eda100;--c4:#e34948;--c5:#6250d6;--c6:#b9b8b2;--c7:#8454d0;--ok:#008300;--bad:#e34948}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--card:#222221;--ink:#f0efec;--ink2:#c3c2b7;--line:#3a3a38;
--c1:#3987e5;--c2:#199e70;--c3:#c98500;--c4:#e66767;--c5:#9085e9;--c6:#6b6a66;--c7:#ab85ed;--ok:#3fae3f;--bad:#e66767}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--card:#222221;--ink:#f0efec;--ink2:#c3c2b7;--line:#3a3a38;
--c1:#3987e5;--c2:#199e70;--c3:#c98500;--c4:#e66767;--c5:#9085e9;--c6:#6b6a66;--c7:#ab85ed;--ok:#3fae3f;--bad:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:0}h3{font-size:14px;margin:14px 0 4px;color:var(--ink2)}
.sub{color:var(--ink2);margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 14px}
.card header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.bar{width:100%;height:auto;display:block;margin-bottom:8px}.bl{font-size:11px;fill:#fff;font-weight:600}
.c1{fill:var(--c1);background:var(--c1)}.c2{fill:var(--c2);background:var(--c2)}.c3{fill:var(--c3);background:var(--c3)}
.c4{fill:var(--c4);background:var(--c4)}.c5{fill:var(--c5);background:var(--c5)}.c6{fill:var(--c6);background:var(--c6)}.c7{fill:var(--c7);background:var(--c7)}
.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 4px;font-size:13px;color:var(--ink2)}
.pill{font-size:12px;padding:2px 10px;border-radius:99px;border:1px solid var(--line);color:var(--ink2)}
.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.bad{color:var(--bad);border-color:var(--bad)}
.meta{color:var(--ink2);font-size:13px;margin:4px 0}ul{margin:4px 0 0;padding-left:20px}li{margin:2px 0}
details{margin-top:8px}summary{cursor:pointer;font-weight:600}
.note{border-left:3px solid var(--c3);padding:4px 12px;color:var(--ink2);font-size:13px;margin-bottom:14px}
</style></head><body><main>
<h1>TaskDesk phase report</h1>
<p class="sub">Updated ${esc(data.generated.slice(0, 16).replace("T", " "))} UTC · ${total} requirements in P0–P5</p>
${data.status ? `<p class="note">${esc(data.status)}</p>` : ""}
<p class="meta">Source implementation, tested behavior, browser verification and Thomas acceptance are separate. Counts below require complete requirement evidence; scoped passes are listed in validation details.</p>
<p class="meta">Review once at phase end; fix and retry up to three rounds. A fourth round needs Thomas’s approval.</p>
<section class="card"><h2>Overall</h2>${bar(all)}<div class="legend">${legend}</div></section>
${rows}
${sharedGaps}
${validation}
${goal}
${decisions}
${next}
</main></body></html>`;

writeFileSync("docs/report/report.html", html);
console.log("wrote docs/report/report.html");

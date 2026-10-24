// Generate self-contained docs/report/report.html from docs/report/data.json. Never hand-edit the output.
import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("docs/report/data.json", "utf8"));
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const STATES = [
  ["implemented_tested", "Done and tested", "c1"],
  ["implemented_untested", "Done, no test", "c2"],
  ["partial", "Partial", "c3"],
  ["missing", "Missing", "c4"],
  ["external_blocked", "Blocked", "c5"],
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
    pass_with_conditions: "Review passed (conditions fixed)",
    fail: "Review failed",
  })[v] ?? "Not reviewed yet";

const rows = data.phases
  .map((p) => {
    const summary = STATES.map(([k, l]) =>
      count(p, k) ? `${l} ${count(p, k)}` : "",
    )
      .filter(Boolean)
      .join(" · ");
    const gates = p.gates?.note
      ? ` Gates: ${esc(p.gates.pass)} pass, ${esc(p.gates.fail)} fail (${esc(p.gates.note)}).`
      : "";
    const carry = p.carry?.length
      ? `<h3>Carried forward</h3><ul>${p.carry.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
      : "";
    return `<section class="card">
<header><h2>${esc(p.id)} · ${esc(p.name)}</h2><span class="pill ${verdictClass(p.review.verdict)}">${verdictLabel(p.review.verdict)}</span></header>
${bar(p)}
<p class="meta">${summary} of ${p.total}</p>
<p class="meta">${esc(p.review.note ?? "")}${gates}</p>
${carry}
</section>`;
  })
  .join("\n");

const decisions = data.decisions.length
  ? `<section class="card"><h2>Needs your decision</h2><ul>${data.decisions.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></section>`
  : "";
const next = data.next
  ? `<section class="card"><h2>Next</h2><p>${esc(data.next)}</p></section>`
  : "";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TaskDesk Phase Report</title>
<style>
:root{color-scheme:light;--bg:#fcfcfb;--card:#fff;--ink:#0b0b0b;--ink2:#52514e;--line:#e4e3df;
--c1:#2a78d6;--c2:#1baf7a;--c3:#eda100;--c4:#e34948;--c5:#6250d6;--c6:#b9b8b2;--ok:#008300;--bad:#e34948}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--card:#222221;--ink:#f0efec;--ink2:#c3c2b7;--line:#3a3a38;
--c1:#3987e5;--c2:#199e70;--c3:#c98500;--c4:#e66767;--c5:#9085e9;--c6:#6b6a66;--ok:#3fae3f;--bad:#e66767}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--card:#222221;--ink:#f0efec;--ink2:#c3c2b7;--line:#3a3a38;
--c1:#3987e5;--c2:#199e70;--c3:#c98500;--c4:#e66767;--c5:#9085e9;--c6:#6b6a66;--ok:#3fae3f;--bad:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:0}h3{font-size:14px;margin:14px 0 4px;color:var(--ink2)}
.sub{color:var(--ink2);margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 14px}
.card header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.bar{width:100%;height:auto;display:block;margin-bottom:8px}.bl{font-size:11px;fill:#fff;font-weight:600}
.c1{fill:var(--c1);background:var(--c1)}.c2{fill:var(--c2);background:var(--c2)}.c3{fill:var(--c3);background:var(--c3)}
.c4{fill:var(--c4);background:var(--c4)}.c5{fill:var(--c5);background:var(--c5)}.c6{fill:var(--c6);background:var(--c6)}
.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 4px;font-size:13px;color:var(--ink2)}
.pill{font-size:12px;padding:2px 10px;border-radius:99px;border:1px solid var(--line);color:var(--ink2)}
.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.bad{color:var(--bad);border-color:var(--bad)}
.meta{color:var(--ink2);font-size:13px;margin:4px 0}ul{margin:4px 0 0;padding-left:20px}li{margin:2px 0}
.note{border-left:3px solid var(--c3);padding:4px 12px;color:var(--ink2);font-size:13px;margin-bottom:14px}
</style></head><body><main>
<h1>TaskDesk phase report</h1>
<p class="sub">Updated ${esc(data.generated.slice(0, 16).replace("T", " "))} UTC · ${total} requirements in P0–P5</p>
<div class="note">Counts come from the requirement audit and the Opus phase reviews. They show source and test evidence plus the reviewer's judgement. Nothing here is accepted by Thomas yet. Browser checks are in <code>docs/report/screens</code>.</div>
<section class="card"><h2>Overall</h2>${bar(all)}<div class="legend">${legend}</div></section>
${rows}
${decisions}
${next}
</main></body></html>`;

writeFileSync("docs/report/report.html", html);
console.log("wrote docs/report/report.html");

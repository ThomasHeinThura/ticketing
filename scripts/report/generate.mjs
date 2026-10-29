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
  ["unaudited", "Unverified / conditional scope", "c6"],
];
const count = (p, k) => p.states[k] ?? p[k] ?? 0;

function bar(p, w = 640) {
  const h = 26;
  let x = 0;
  const breakdown = STATES.map(([k, label]) => `${label}: ${count(p, k)}`).join(
    ", ",
  );
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(p.id)} requirement states, ${esc(breakdown)}" class="bar">`;
  for (const [k, label, cls] of STATES) {
    const n = count(p, k);
    if (!n) continue;
    const bw = (n / p.total) * w;
    svg += `<rect x="${x + 1}" y="0" width="${Math.max(bw - 2, 1)}" height="${h}" rx="3" class="${cls}"><title>${esc(label)}: ${n}</title></rect>`;
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
  ([k, l, c]) =>
    `<span class="lg"><i class="${c}"></i>${esc(l)}: ${count(all, k)}</span>`,
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
<header><h2>${esc(p.id)} · ${esc(p.name)}</h2><span><span class="pill ${verdictClass(p.review.verdict)}">${verdictLabel(p.review.verdict)}</span>${p.accepted ? ` <span class="pill ok">Thomas accepted</span>` : ""}</span></header>
${p.accepted ? `<p class="meta">${esc(p.accepted)}</p>` : ""}
${bar(p)}
<p class="meta">${summary} of ${p.total}</p>
${p.browser ? `<p class="meta">Full browser verification: ${esc(p.browser.verified)} / ${esc(p.total)} requirements.</p>` : ""}
<p class="meta">${gates} Review: ${esc(p.review.roundsConsumed ?? 0)}/${esc(p.review.maxTotalRounds ?? 3)} rounds used · ${esc(p.review.findings ?? 0)} recorded findings.</p>
${p.review.note ? `<p class="meta">${esc(p.review.note)}</p>` : ""}
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

// Reports only link to explicitly provided HTTP(S) destinations.
function externalLink(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return esc(label);
    return `<a href="${esc(parsed.href)}">${esc(label)}</a>`;
  } catch {
    return esc(label);
  }
}
const adminFollowUp = data.roadmap?.adminFollowUp
  ? `<details><summary>Workspace-admin follow-up evidence</summary><p class="meta">${esc(data.roadmap.adminFollowUp.summary)}</p><p>${externalLink(data.roadmap.adminFollowUp.ledger, "Role assertions and complete case ledger")}</p><ul>${data.roadmap.adminFollowUp.screenshots.map((shot) => `<li>${externalLink(shot.url, shot.label)}</li>`).join("")}</ul></details>`
  : "";
const roadmap = data.roadmap
  ? `<section id="overview" class="overview">
<div class="section-heading"><div><p class="eyebrow">CURRENT WORK · L-05</p><h1>Performance headroom</h1><p class="lead">${esc(data.roadmap.goal)}</p></div><span class="status-pill">${esc(data.roadmap.items.find((item) => item.id === "L-05")?.status ?? "Status unavailable")}</span></div>
${data.roadmap.activeWork ? `<p class="active-work"><strong>Active local work</strong> · ${esc(data.roadmap.activeWork)}</p>` : ""}
<div class="overview-grid"><article class="card status-card"><p class="eyebrow">LATEST HOSTED CANDIDATE</p><h2>CI &amp; performance</h2><p class="status-copy">${esc(data.roadmap.note)}</p><p class="meta">${esc(data.roadmap.validation)}</p><div class="link-row">${externalLink(data.roadmap.ci, "View hosted run ↗")} ${externalLink(data.roadmap.pr, "Open draft PR ↗")}</div></article>
<article class="card status-card"><p class="eyebrow">SCOPED BROWSER EVIDENCE</p><h2>Local SIT follow-up</h2><p class="status-copy">${esc(data.roadmap.adminFollowUp?.summary ?? "Browser evidence unavailable.")}</p><p class="meta">The SIT source is recorded separately from the latest hosted candidate. Refer to the evidence for exact scope and retained failures.</p></article></div>
</section>
<section id="performance" class="card panel"><div class="panel-header"><div><p class="eyebrow">G11 · HOSTED MEASUREMENTS</p><h2>Performance results</h2><p class="meta">Budget and 15% headroom are separate checks.</p></div><span class="source-label">Commit <code>${esc(data.roadmap.testedCommit.slice(0, 9))}</code></span></div>
<p class="meta measurement">${esc(data.roadmap.measurement)} This is a generated snapshot, not live GitHub data.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Latest hosted candidate metrics table"><table class="metrics"><caption>Latest hosted candidate metrics</caption><thead><tr><th scope="col">Metric</th><th scope="col">Measured</th><th scope="col">Budget</th><th scope="col">15% headroom</th><th scope="col">Budget result</th><th scope="col">Headroom result</th></tr></thead><tbody>${data.roadmap.metrics.map((m) => `<tr><th scope="row">${esc(m.name)}</th><td class="measured">${esc(m.measured)}</td><td>${esc(m.budget)}</td><td>${esc(m.target)}</td><td><span class="result ${m.result === "Fail" ? "fail" : m.result === "Pass" ? "pass" : "pending"}">${esc(m.result)}</span></td><td><span class="result ${m.headroom === "Fail" ? "fail" : m.headroom === "Pass" ? "pass" : "pending"}">${esc(m.headroom)}</span></td></tr>`).join("")}</tbody></table></div>
<details class="disclosure"><summary>Local verification and prior candidates</summary><p class="meta">${esc(data.roadmap.localVerification)}</p>${data.roadmap.evidenceURL ? `<p>${externalLink(data.roadmap.evidenceURL, "Candidate local-check evidence ↗")}</p>` : ""}<details><summary>Previous hosted candidates</summary>${data.roadmap.previousRuns.map((run) => `<p class="meta">Tested commit <code>${esc(run.testedCommit)}</code> · ${externalLink(run.ci, "Previous hosted job")}. ${esc(run.measurement)}</p><ul>${run.metrics.map((m) => `<li>${esc(m.name)}: ${esc(m.measured)}; budget ${esc(m.budget)}; headroom target ${esc(m.target)}; budget ${esc(m.result)}${m.headroom ? `; headroom ${esc(m.headroom)}` : ""}.</li>`).join("")}</ul><p class="meta">${esc(run.validation)}</p>${run.localVerification ? `<p class="meta">${esc(run.localVerification)}</p>` : ""}`).join("")}</details></details>
${adminFollowUp}</section>
<section id="roadmap" class="card panel"><div class="panel-header"><div><p class="eyebrow">ORDERED BACKLOG</p><h2>Roadmap</h2><p class="meta">Work proceeds in the retained order. Completion requires evidence and approval.</p></div><span class="source-label">Updated ${esc(data.roadmap.updated.slice(0, 16).replace("T", " "))} UTC</span></div>
<div class="table-wrap" tabindex="0" role="region" aria-label="Ordered backlog table"><table class="backlog"><caption>Ordered backlog</caption><thead><tr><th scope="col">Item</th><th scope="col">Status</th><th scope="col">Done when</th></tr></thead><tbody>${data.roadmap.items.map((item) => `<tr><th scope="row">${item.link ? externalLink(item.link, item.id) : esc(item.id)} <span class="item-name">${esc(item.name)}</span></th><td>${esc(item.status)}</td><td>${esc(item.done)}</td></tr>`).join("")}</tbody></table></div></section>`
  : "";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TaskDesk roadmap and audit report</title>
<style>
:root{color-scheme:light;--bg:#fafafa;--card:#fff;--ink:#262626;--ink2:#595959;--line:#e5e5e5;--subtle:#f5f5f5;--sidebar:#f7f7f7;--c1:#2a78d6;--c2:#1baf7a;--c3:#b77400;--c4:#d84443;--c5:#6250d6;--c6:#92918c;--c7:#8454d0;--ok:#14713c;--bad:#a52b2a;--ok-bg:#eaf6ee;--bad-bg:#fff0ef;--shadow:0 1px 2px #00000008}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#171717;--card:#1e1e1e;--ink:#ededed;--ink2:#bcbcbc;--line:#373737;--subtle:#292929;--sidebar:#1b1b1b;--c1:#3987e5;--c2:#199e70;--c3:#c98500;--c4:#e66767;--c5:#9085e9;--c6:#777671;--c7:#ab85ed;--ok:#80d69f;--bad:#ff9995;--ok-bg:#183a27;--bad-bg:#482725;--shadow:none}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 Geist,system-ui,-apple-system,sans-serif}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}.sidebar{background:var(--sidebar);border-right:1px solid var(--line);padding:22px 14px;position:sticky;top:0;height:100vh}.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;padding:0 8px 27px}.brand-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--ink);color:var(--bg);font-size:13px}.nav-label,.eyebrow{color:var(--ink2);font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}.nav-label{padding:0 9px;margin:0 0 8px}.side-nav{display:grid;gap:3px}.side-nav a{padding:8px 10px;border-radius:7px;text-decoration:none;color:var(--ink2);font-weight:500}.side-nav a:hover,.side-nav a:focus-visible{background:var(--subtle);color:var(--ink)}.sidebar-foot{position:absolute;bottom:20px;left:24px;right:20px;color:var(--ink2);font-size:12px}.workspace{min-width:0}.topbar{height:60px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 34px;background:var(--card);gap:12px}.crumb{color:var(--ink2);font-size:13px}.crumb strong{color:var(--ink);font-weight:600}.snapshot{color:var(--ink2);font-size:12px}main{max-width:1260px;margin:0 auto;padding:34px 34px 70px;min-width:0;overflow-wrap:anywhere}.section-heading,.panel-header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.section-heading{margin-bottom:24px}h1{font-size:27px;letter-spacing:-.035em;line-height:1.2;margin:3px 0 10px}h2{font-size:17px;letter-spacing:-.02em;line-height:1.3;margin:0}h3{font-size:13px;margin:14px 0 4px;color:var(--ink2)}p{margin:8px 0}.lead{color:var(--ink2);max-width:720px;margin:0}.eyebrow{margin:0 0 7px}.status-pill,.source-label{font-size:12px;white-space:nowrap;color:var(--ink2);background:var(--subtle);border:1px solid var(--line);border-radius:7px;padding:5px 9px}.active-work{padding:11px 14px;margin:0 0 16px;background:var(--subtle);border:1px solid var(--line);border-radius:8px;color:var(--ink2);font-size:13px}.active-work strong{color:var(--ink)}.overview-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px;box-shadow:var(--shadow);margin:0 0 14px}.overview-grid .card{margin:0}.status-card{min-height:200px}.status-copy{font-size:14px;line-height:1.55;margin:12px 0}.link-row{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px}.link-row a{font-weight:600}.panel{margin-top:22px}.panel-header{margin-bottom:16px}.panel-header .meta{margin-top:5px}.measurement{margin-bottom:14px}.meta{color:var(--ink2);font-size:13px;line-height:1.6}.table-wrap{max-width:100%;overflow-x:auto;overflow-wrap:normal;border:1px solid var(--line);border-radius:8px}.table-wrap:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:2px}table{border-collapse:collapse;width:100%;font-size:13px}caption{text-align:left;font-weight:600;padding:10px 12px;background:var(--subtle)}th,td{text-align:left;vertical-align:middle;padding:12px;border-top:1px solid var(--line)}thead th{color:var(--ink2);font-size:11px;font-weight:600;white-space:nowrap;background:var(--subtle)}tbody th{font-weight:600}.metrics{min-width:690px}.backlog{min-width:620px}.backlog td:last-child{color:var(--ink2)}.item-name{display:block;margin-top:2px;font-weight:500}.measured{font-weight:700;white-space:nowrap}.result{display:inline-block;font-size:12px;font-weight:600;border-radius:5px;padding:3px 7px;background:var(--subtle);white-space:nowrap}.result.fail{color:var(--bad);background:var(--bad-bg)}.result.pass{color:var(--ok);background:var(--ok-bg)}a{color:inherit;text-decoration:underline;text-underline-offset:3px}ul{margin:6px 0 0;padding-left:20px}li{margin:4px 0}details{margin-top:12px}summary{cursor:pointer;font-weight:600;font-size:13px}details p{margin:8px 0}.disclosure{border-top:1px solid var(--line);padding-top:16px;margin-top:18px}.history-header{margin:42px 0 16px}.history-header h2{font-size:22px}.history-header p{color:var(--ink2)}.history-snapshot{margin:0 0 14px}.history-snapshot summary{font-size:14px}.card header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}.bar{width:100%;height:auto;display:block;margin:10px 0}.c1{fill:var(--c1);background:var(--c1)}.c2{fill:var(--c2);background:var(--c2)}.c3{fill:var(--c3);background:var(--c3)}.c4{fill:var(--c4);background:var(--c4)}.c5{fill:var(--c5);background:var(--c5)}.c6{fill:var(--c6);background:var(--c6)}.c7{fill:var(--c7);background:var(--c7)}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 4px;font-size:13px;color:var(--ink2)}.pill{font-size:12px;padding:2px 10px;border-radius:99px;border:1px solid var(--line);color:var(--ink2)}.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.bad{color:var(--bad);border-color:var(--bad)}code{font-family:ui-monospace,monospace;font-size:.92em}
@media(max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}.sidebar{min-width:0;position:static;height:auto;padding:12px 18px;border-right:0;border-bottom:1px solid var(--line)}.brand{padding:0 0 9px}.nav-label,.sidebar-foot{display:none}.side-nav{display:flex;gap:4px;overflow-x:auto}.side-nav a{white-space:nowrap;padding:6px 9px}.topbar{padding:0 20px;height:52px}main{padding:26px 20px 50px}}
@media(max-width:620px){.overview-grid{grid-template-columns:1fr}.section-heading,.panel-header{flex-wrap:wrap}.status-card{min-height:0}.card{padding:16px}.topbar .snapshot{display:none}main{padding:24px 16px 48px}h1{font-size:25px}.history-header{margin-top:32px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark" aria-hidden="true">T</span><span>TaskDesk</span></div><p class="nav-label">Report</p><nav class="side-nav" aria-label="Report sections"><a href="#overview">Overview</a><a href="#performance">Performance</a><a href="#roadmap">Roadmap</a><a href="#audit">Audit history</a></nav><p class="sidebar-foot">Generated evidence snapshot<br>Not live GitHub data</p></aside><div class="workspace"><header class="topbar"><div class="crumb">TaskDesk <span aria-hidden="true"> / </span> <strong>Roadmap report</strong></div><span class="snapshot">Generated snapshot · ${esc(data.roadmap?.updated.slice(0, 16).replace("T", " ") ?? "")} UTC</span></header><main>
${roadmap}
<div class="history-header" id="audit"><p class="eyebrow">L-01 · FROZEN AUDIT</p><h2>Audit &amp; phase history</h2><p>${total} requirements · snapshot ${esc(data.generated.slice(0, 16).replace("T", " "))} UTC. Source, tested behavior, browser verification and acceptance are separate.</p></div>
${data.status ? `<details class="card history-snapshot"><summary>Read the L-01 audit snapshot</summary><p class="meta">${esc(data.status)}</p></details>` : ""}
<section class="card"><h2>Overall requirement evidence</h2>${bar(all)}<div class="legend">${legend}</div></section>
${rows}
${sharedGaps}
${validation}
${goal}
${decisions}
${next}
</main></div></div></body></html>`;

writeFileSync("docs/report/report.html", html);
console.log("wrote docs/report/report.html");

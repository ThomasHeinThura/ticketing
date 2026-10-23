// Merge audit JSON files into docs/report/data.json (keeps manual review/gates/decisions).
// Usage: node scripts/report/build-data.mjs <audit-dir>
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const STATES = [
  "implemented_tested",
  "implemented_untested",
  "partial",
  "missing",
  "external_blocked",
];
const auditDir = process.argv[2];
const out = "docs/report/data.json";
mkdirSync("docs/report", { recursive: true });

const index = JSON.parse(
  readFileSync("docs/requirements-index.json", "utf8"),
).requirements;
const prev = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const names = {
  P0: "Foundation",
  P1: "Core work",
  P2: "Service desk",
  P3: "Portal & identity",
  P4: "Governance",
};

const audits = {};
if (auditDir) {
  for (const f of readdirSync(auditDir).filter((n) => /^audit-P\d/.test(n))) {
    const a = JSON.parse(readFileSync(join(auditDir, f), "utf8"));
    audits[a.phase] ??= { items: new Map(), gaps: [], actions: [] };
    const p = audits[a.phase];
    for (const it of a.items) p.items.set(it.id, it);
    p.gaps.push(...(a.top_gaps ?? []));
    p.actions.push(...(a.tonight_actions ?? []));
  }
}

const phases = Object.keys(names).map((id) => {
  const reqs = index.filter((r) => r.phase === id);
  const states = Object.fromEntries(STATES.map((s) => [s, 0]));
  let unaudited = 0;
  for (const r of reqs) {
    const it = audits[id]?.items.get(r.id);
    if (it && STATES.includes(it.state)) states[it.state]++;
    else unaudited++;
  }
  const old = prev.phases?.find((x) => x.id === id) ?? {};
  if (old.states_locked) return { ...old, total: reqs.length };
  return {
    id,
    name: names[id],
    total: reqs.length,
    states,
    unaudited,
    gaps: audits[id]?.gaps ?? old.gaps ?? [],
    actions: audits[id]?.actions ?? old.actions ?? [],
    review: old.review ?? {
      verdict: "not run",
      findings: 0,
      note: "Opus review runs at phase end",
    },
    gates: old.gates ?? {
      pass: 0,
      fail: 0,
      not_run: 0,
      note: "no gates run yet",
    },
  };
});

writeFileSync(
  out,
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      source:
        prev.source ??
        "docs/requirements-index.json + Opus source audit (no browser verification implied)",
      phases,
      decisions: prev.decisions ?? [],
      next: prev.next ?? "",
    },
    null,
    2,
  ),
);
console.log("wrote", out);

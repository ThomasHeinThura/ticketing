import pg from "pg";
const c = new pg.Client("postgresql://postgres:postgres@127.0.0.1:55440/taskdesk_test");
await c.connect();
const t = await c.query(`select tgname, relname from pg_trigger tg join pg_class c on c.oid=tg.tgrelid where not tgisinternal`);
console.log("LEFTOVER TRIGGERS:", JSON.stringify(t.rows));
for (const r of t.rows) {
  await c.query(`DROP TRIGGER IF EXISTS "${r.tgname}" ON "${r.relname}"`);
}
const f = await c.query(`select proname from pg_proc where proname like 'td_probe%'`);
console.log("PROBE FUNCTIONS:", JSON.stringify(f.rows));
for (const r of f.rows) await c.query(`DROP FUNCTION IF EXISTS ${r.proname}() CASCADE`);
const tabs = await c.query(`select tablename from pg_tables where schemaname='public' and tablename like '%hidden%'`);
console.log("HIDDEN TABLES:", JSON.stringify(tabs.rows));
for (const r of tabs.rows) await c.query(`ALTER TABLE "${r.tablename}" RENAME TO "${r.tablename.replace('_hidden','')}"`);
const after = await c.query(`select tgname from pg_trigger tg where not tgisinternal`);
console.log("TRIGGERS AFTER CLEANUP:", after.rowCount);
await c.end();

import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  removeWorkItem,
  rowsOf,
  signIn,
  stamp,
  taskTypeId,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

/**
 * Release journey: import apply. Needs an `instance-admin` account in SIT_ACCOUNTS_FILE;
 * scripts/sit/release-suite.mjs only runs this config when that account exists and reports
 * it as NOT RUN otherwise.
 */
test("an instance administrator previews and applies a CSV import and the item is removed again", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const lead = await signIn(browser, "lead");
  const root = await signIn(browser, "instance-admin");
  let itemKey: string | null = null;
  try {
    const { workspaceId, projectId } = await discoverTarget(lead);
    const typeId = await taskTypeId(lead, projectId);
    const runStamp = stamp();
    const title = `R929 import apply ${runStamp}`;
    const source = await root.call("POST", "/import-sources", {
      workspaceId,
      pluginId: "import.csv",
      name: `R929 import ${stamp()}`,
      config: {
        csvText: `external_id,title,type,state\nR929-${runStamp},${title},task,Todo\n`,
      },
    });
    expect(source.status).toBe(200);
    const run = await root.call(
      "POST",
      `/import-sources/${source.body.id}/runs`,
      { projectId, sourceRef: "r929.csv" },
    );
    expect(run.status).toBe(200);
    const runId = run.body.id as string;

    // Setup steps run in the background; poll the engine job until it settles.
    async function step(name: "discover" | "dry-run-all") {
      const started = await root.call("POST", `/imports/${runId}/${name}`, {});
      expect(started.status).toBe(202);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const engine = await root.call("GET", `/imports/${runId}/engine`);
        if (engine.body?.job && engine.body.job.status !== "running") {
          expect(engine.body.job.status, `${name} job`).toBe("completed");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error(`Import ${name} did not finish in time.`);
    }
    await step("discover");
    const mapping = await root.call("GET", `/imports/${runId}/mapping`);
    expect(mapping.status).toBe(200);
    const entries = (
      mapping.body.entries as Array<{ domain: string; value: string }>
    ).map((entry) => ({
      domain: entry.domain,
      value: entry.value,
      target:
        entry.domain === "type"
          ? { kind: "target", id: typeId }
          : entry.domain === "state"
            ? { kind: "group", group: "started" }
            : { kind: "ignore" },
    }));
    const confirmed = await root.call("POST", `/imports/${runId}/mapping`, {
      expectedMappingVersion: mapping.body.mappingVersion,
      entries,
      confirmProposals: true,
    });
    expect(confirmed.status).toBe(200);
    await step("dry-run-all");
    const report = await root.call("GET", `/imports/${runId}/dry-run-all`);
    expect(report.status).toBe(200);
    expect(report.body.counts.created).toBe(1);
    expect(report.body.counts.rejected).toBe(0);

    const executed = await root.call("POST", `/imports/${runId}/execute`, {
      dryRunDigest: report.body.digest,
      mappingVersion: report.body.mappingVersion,
      totalCount: report.body.counts.processed,
    });
    expect(executed.status, "one row needs no approval").toBe(202);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const state = await root.call("GET", `/imports/${runId}`);
      if (state.body?.status === "completed") break;
      expect(state.body?.status).not.toBe("failed");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const found = await lead.call(
      "GET",
      `/projects/${projectId}/work-items?limit=50`,
    );
    const item = rowsOf<{ key: string; title: string }>(found.body).find(
      (row) => row.title === title,
    );
    expect(item, "the imported item exists").toBeTruthy();
    itemKey = item?.key ?? null;
  } finally {
    // Cleanup: the imported work item goes through the normal pending-action deletion.
    if (itemKey) await removeWorkItem(lead, itemKey);
    await Promise.all([lead, root].map((session) => session.context.close()));
  }
});

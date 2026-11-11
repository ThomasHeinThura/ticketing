import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptDeliveryEnvelope } from "../../../apps/api/src/customer-invitation/delivery/envelope.js";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret.js";
import {
  decryptSecret,
  encryptSecret,
} from "../../../apps/api/src/notification-preferences/secrets.js";
import {
  applyCandidateCopyTransformInTransaction,
  buildInertCandidateSecretPlaintext,
  CANDIDATE_COPY_REVIEWED_CATALOGUE_HASH,
  CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST,
  CANDIDATE_COPY_SCRUB_DELETABLE_TABLES,
  type CandidateCopyDatabaseSnapshot,
  type CandidateCopyRow,
  type CandidateCopyRowBackedTable,
  type CandidateCopyTableState,
  type CandidateCopyTransactionalBoundary,
  CandidateCopyTransformError,
  type CandidateCopyTransformInput,
  computeCandidateCopyCatalogueHash,
  computeProtectedTableFingerprint,
  inspectCandidateCopySnapshot,
  toSelectorPreservationProof,
  transformCandidateCopySnapshot,
  verifyTransformedCandidateCopySnapshot,
} from "../../../apps/api/src/secrets/candidate-copy-transform.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiRequire = createRequire(path.join(repoRoot, "apps/api/package.json"));
const { symmetricDecrypt, symmetricEncrypt } = apiRequire(
  "better-auth/crypto",
) as {
  symmetricDecrypt(input: { key: string; data: string }): Promise<string>;
  symmetricEncrypt(input: { key: string; data: string }): Promise<string>;
};
const catalogue = (
  JSON.parse(
    readFileSync(
      path.join(repoRoot, "deploy/local-candidate-schema-catalogue.json"),
      "utf8",
    ),
  ) as {
    tables: { schema: string; table: string; columns: string[] }[];
  }
).tables;
const columnsOf = (table: string): string[] => {
  const entry = catalogue.find(
    (candidate) => `${candidate.schema}.${candidate.table}` === table,
  );
  if (!entry) throw new Error(`Unknown catalogue table ${table}`);
  return entry.columns;
};

const BASELINE_ENC = "11".repeat(32);
const CANDIDATE_ENC = "22".repeat(32);
const BASELINE_AUTH = "synthetic-baseline-auth-secret-0123456789abcdef";
const CANDIDATE_AUTH = "synthetic-candidate-auth-secret-fedcba9876543210";
const CREDENTIAL = "synthetic_invitation_credential_token_00010";
const MARKERS = [
  "super-secret-plugin-api-token-live-001",
  "super-secret-oidc-client-secret-live-002",
  "https://hooks.slack.com/services/T000/B000/LIVEWEBHOOK003",
  "ntfy-live-token-secret-005",
  "AAAAAAAAAAAAAAAABBBBBBBBBBBBBBBB",
  "backup-alpha-001",
  CREDENTIAL,
  "oauth-live-access-token-011",
  BASELINE_ENC,
  CANDIDATE_ENC,
  BASELINE_AUTH,
  CANDIDATE_AUTH,
];
const VOLUMES = {
  baselinePostgresVolume: "taskdesk-local_postgres_data",
  candidatePostgresVolume: "taskdesk-candidate-pr-1112_postgres_data",
  baselineAttachmentsVolume: "taskdesk-local_attachments_data",
  candidateAttachmentsVolume: "taskdesk-candidate-pr-1112_attachments_data",
};
const RUNTIME = {
  source: "verified-candidate-profile",
  slot: "pr-1112",
  candidateImageDigest: `sha256:${"a".repeat(64)}`,
  candidateEnvFingerprint: "b".repeat(64),
  runtimeRole: "web",
  candidateReadOnly: true,
  networkExternalEgressBlocked: true,
  autonomousWorkersDisabled: true,
  nonPasswordLocalAuthDisabled: true,
  runnableJobHandlers: 0,
  webInvitationPollerEnabled: false,
} as const;

function withKey<T>(keyHex: string, fn: () => T): T {
  const previous = process.env.TASKDESK_ENCRYPTION_KEY;
  process.env.TASKDESK_ENCRYPTION_KEY = keyHex;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TASKDESK_ENCRYPTION_KEY;
    else process.env.TASKDESK_ENCRYPTION_KEY = previous;
  }
}

/** A row with every real catalogue column (null by default); an unknown column name throws. */
function row(table: string, values: CandidateCopyRow): CandidateCopyRow {
  const columns = columnsOf(table);
  const unknown = Object.keys(values).filter((key) => !columns.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${table} has no column ${unknown.join(", ")}`);
  }
  return Object.fromEntries(
    columns.map((column) => [column, values[column] ?? null]),
  );
}

const digestOf = (table: string) =>
  computeProtectedTableFingerprint(table, [{ digest: table }], []);

function buildSnapshot(
  managed: Record<string, CandidateCopyRow[]>,
): CandidateCopyDatabaseSnapshot {
  const tables: Record<string, CandidateCopyTableState> = {};
  for (const entry of catalogue) {
    const name = `${entry.schema}.${entry.table}`;
    const rows = managed[name];
    tables[name] = rows
      ? { columns: entry.columns, rows }
      : name === "public.person"
        ? {
            columns: entry.columns,
            rows: [row(name, { id: "person-1", user_id: "user-mfa-1" })],
          }
        : {
            columns: entry.columns,
            observation: "digest-only",
            rowCount: 3,
            protectedFingerprint: digestOf(name),
          };
  }
  for (const name of [
    ...Object.keys(CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST),
    ...CANDIDATE_COPY_SCRUB_DELETABLE_TABLES,
    "public.user",
  ]) {
    if (!managed[name]) {
      tables[name] = { columns: columnsOf(name), rows: [] };
    }
  }
  return {
    catalogueHash: CANDIDATE_COPY_REVIEWED_CATALOGUE_HASH,
    tables,
    attachments: { objectCount: 42, fingerprint: "sha256:attachments" },
  };
}

async function baselineSnapshot(): Promise<CandidateCopyDatabaseSnapshot> {
  const tdk1 = (id: string, plaintext: string) =>
    withKey(BASELINE_ENC, () => encryptIdentityClientSecret(id, plaintext));
  const encV2 = (plaintext: string) =>
    withKey(BASELINE_ENC, () => encryptSecret(plaintext)) as string;
  const credentialHash = createHash("sha256").update(CREDENTIAL).digest("hex");
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const envelope = withKey(BASELINE_ENC, () =>
    encryptDeliveryEnvelope({
      deliveryId: "delivery-queued-1",
      invitationId: "inv-pending-1",
      credentialHash,
      credential: CREDENTIAL,
      key: {
        id: "delivery-queued-1",
        ownerId,
        keyId: "22222222-2222-4222-8222-222222222222",
        key: Buffer.alloc(32, 0x42),
      },
    }),
  );
  const t = (table: string, values: CandidateCopyRow) => row(table, values);
  return buildSnapshot({
    "public.session": [t("public.session", { id: "sess-1", token: "live" })],
    "public.verification": [t("public.verification", { id: "verif-1" })],
    "public.step_up_confirmation": [
      t("public.step_up_confirmation", { id: "step-1" }),
    ],
    "public.customer_invitation_auth_continuation": [
      t("public.customer_invitation_auth_continuation", { id: "cont-1" }),
    ],
    "public.account": [
      t("public.account", {
        id: "acct-1",
        user_id: "user-mfa-1",
        provider_id: "credential",
        password: "$argon2id$preserved",
        access_token: "oauth-live-access-token-011",
        refresh_token: "oauth-live-refresh-token-012",
        id_token: "oauth-live-id-token-013",
      }),
    ],
    "public.apikey": [
      t("public.apikey", { id: "ba-key-1", name: "CLI", enabled: true }),
    ],
    "public.api_key": [
      t("public.api_key", { apikey_id: "ws-key-active" }),
      t("public.api_key", {
        apikey_id: "ws-key-disabled",
        disabled_at: new Date("2026-01-15T00:00:00.000Z"),
        disabled_reason: "prior_incident",
      }),
    ],
    "public.user": [
      t("public.user", {
        id: "user-mfa-1",
        email: "a@example.test",
        two_factor_enabled: true,
      }),
      t("public.user", {
        id: "user-2",
        email: "b@example.test",
        two_factor_enabled: false,
      }),
    ],
    "public.two_factor": [
      t("public.two_factor", {
        id: "tf-1",
        user_id: "user-mfa-1",
        secret: await symmetricEncrypt({
          key: BASELINE_AUTH,
          data: "AAAAAAAAAAAAAAAABBBBBBBBBBBBBBBB",
        }),
        backup_codes: await symmetricEncrypt({
          key: BASELINE_AUTH,
          data: JSON.stringify(["backup-alpha-001", "backup-beta-002"]),
        }),
      }),
    ],
    "public.instance_plugin_config": [
      t("public.instance_plugin_config", {
        id: "plugin-password",
        plugin_id: "auth.password",
        instance_key: "default",
        enabled: true,
        scope: "instance",
        portal_scope: "both",
      }),
      t("public.instance_plugin_config", {
        id: "plugin-magic-link",
        plugin_id: "auth.magic-link",
        instance_key: "default",
        enabled: true,
        scope: "instance",
        portal_scope: "both",
      }),
      t("public.instance_plugin_config", {
        id: "plugin-slack-1",
        plugin_id: "integration.slack",
        instance_key: "default",
        enabled: true,
        scope: "instance",
        secrets: tdk1(
          "plugin-slack-1",
          "super-secret-plugin-api-token-live-001",
        ),
      }),
    ],
    "public.identity_connection": [
      t("public.identity_connection", {
        id: "idp-okta-1",
        enabled: true,
        client_secret: tdk1(
          "idp-okta-1",
          "super-secret-oidc-client-secret-live-002",
        ),
      }),
    ],
    "public.scim_connection": [
      t("public.scim_connection", {
        identity_connection_id: "idp-okta-1",
        enabled: true,
        token_hash: Buffer.alloc(32, 9),
        token_prefix: "tdk_scim_live",
      }),
    ],
    "public.instance_setting": [
      t("public.instance_setting", {
        id: "setting-1",
        metrics_token_hash: "a".repeat(64),
        metrics_token_rotated_at: new Date("2026-05-01T00:00:00.000Z"),
        setup_token_hash: "b".repeat(64),
        setup_token_expires_at: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ],
    "public.webhook": [
      t("public.webhook", {
        id: "wh-1",
        secret: encV2(
          "https://hooks.slack.com/services/T000/B000/LIVEWEBHOOK003",
        ),
        secret_previous: encV2("previous-webhook-secret-004"),
        active: true,
      }),
    ],
    "public.user_notification_preference": [
      t("public.user_notification_preference", {
        id: "unp-1",
        user_id: "user-mfa-1",
        ntfy_token: encV2("ntfy-live-token-secret-005"),
      }),
    ],
    "public.import_source_connection": [
      t("public.import_source_connection", {
        id: "imp-1",
        credential_ciphertext: encV2("zendesk-api-live-credential-008"),
      }),
    ],
    "public.customer_invitation_delivery": [
      t("public.customer_invitation_delivery", {
        id: "delivery-queued-1",
        invitation_id: "inv-pending-1",
        credential_hash: credentialHash,
        envelope,
        state: "queued",
        attempts: 0,
        owner_id: ownerId,
        updated_at: new Date("2026-11-11T10:00:00.000Z"),
      }),
      t("public.customer_invitation_delivery", {
        id: "delivery-sent-2",
        invitation_id: "inv-accepted-2",
        state: "sent",
        terminal_code: "sent",
        attempts: 1,
      }),
    ],
    "public.invitation": [
      t("public.invitation", {
        id: "inv-pending-1",
        status: "pending",
        credential_hash: credentialHash,
        email: "c@example.test",
      }),
      t("public.invitation", { id: "inv-accepted-2", status: "accepted" }),
    ],
    "public.automation": [
      t("public.automation", { id: "auto-1", enabled: true }),
    ],
    "public.instance_job_configuration": [
      t("public.instance_job_configuration", {
        name: "outbox-drain",
        enabled: true,
      }),
    ],
    "public.outbox": [
      t("public.outbox", { event_id: "ev-pending", state: "pending" }),
      t("public.outbox", { event_id: "ev-dead", state: "dead" }),
    ],
    "public.notification_delivery": [
      t("public.notification_delivery", { id: "nd-1", state: "pending" }),
      t("public.notification_delivery", { id: "nd-2", state: "delivered" }),
    ],
    "public.webhook_delivery": [
      t("public.webhook_delivery", { id: "wd-1", state: "pending" }),
      t("public.webhook_delivery", { id: "wd-2", state: "delivered" }),
    ],
    "public.automation_run": [
      t("public.automation_run", { id: "ar-1", state: "running" }),
      t("public.automation_run", { id: "ar-2", state: "done" }),
    ],
    "public.import_run": [
      t("public.import_run", { id: "ir-1", state: "queued" }),
      t("public.import_run", { id: "ir-2", state: "completed" }),
    ],
  });
}

const baseInput = (
  snapshot: CandidateCopyDatabaseSnapshot,
  overrides: Partial<CandidateCopyTransformInput> = {},
): CandidateCopyTransformInput => ({
  slot: "pr-1112",
  volumes: VOLUMES,
  baselineEncryptionKey: BASELINE_ENC,
  candidateEncryptionKey: CANDIDATE_ENC,
  baselineAuthSecret: BASELINE_AUTH,
  candidateAuthSecret: CANDIDATE_AUTH,
  now: new Date("2026-11-11T15:00:00.000Z"),
  catalogue,
  runtimeObservation: RUNTIME,
  snapshot,
  ...overrides,
});

function edit(
  snapshot: CandidateCopyDatabaseSnapshot,
  table: string,
  change: (rows: CandidateCopyRow[]) => CandidateCopyRow[] | undefined,
): CandidateCopyDatabaseSnapshot {
  const next = structuredClone(snapshot);
  const state = next.tables[table] as CandidateCopyRowBackedTable;
  const rows = [...state.rows];
  (next.tables as Record<string, CandidateCopyTableState>)[table] = {
    ...state,
    rows: change(rows) ?? rows,
  };
  return next;
}
const patch = (
  snapshot: CandidateCopyDatabaseSnapshot,
  table: string,
  index: number,
  values: CandidateCopyRow,
) =>
  edit(snapshot, table, (rows) => {
    rows[index] = { ...rows[index], ...values };
    return rows;
  });
const rowsOf = (snapshot: CandidateCopyDatabaseSnapshot, table: string) =>
  (snapshot.tables[table] as CandidateCopyRowBackedTable).rows;

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CandidateCopyTransformError);
    return error as CandidateCopyTransformError;
  }
  throw new Error("Expected the call to reject");
}

describe("candidate-copy-transform", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.TASKDESK_ENCRYPTION_KEY;
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  describe("reviewed catalogue and physical identifiers", () => {
    it("pins the reviewed 184-table / 1974-column catalogue", () => {
      expect(computeCandidateCopyCatalogueHash(catalogue)).toBe(
        CANDIDATE_COPY_REVIEWED_CATALOGUE_HASH,
      );
      expect(catalogue).toHaveLength(184);
      expect(catalogue.reduce((n, entry) => n + entry.columns.length, 0)).toBe(
        1974,
      );
    });

    it("only scrubs columns that exist physically, and uses the real keys", () => {
      for (const [table, columns] of Object.entries(
        CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST,
      )) {
        for (const column of columns) {
          expect(columnsOf(table)).toContain(column);
        }
      }
      expect(columnsOf("public.api_key")).toContain("apikey_id");
      expect(columnsOf("public.scim_connection")).toContain(
        "identity_connection_id",
      );
      expect(columnsOf("public.instance_job_configuration")).toContain("name");
      expect(columnsOf("public.outbox")).toContain("event_id");
      expect(columnsOf("public.api_key")).not.toContain("id");
      expect(columnsOf("public.api_key")).not.toContain("revoked_at");
    });
  });

  it("projects the exact ordered preservation shape the selector asserts", async () => {
    const selector = readFileSync(
      path.join(repoRoot, "deploy/local-candidate-selection.mjs"),
      "utf8",
    );
    const selectorHash = /reviewedCatalogueHash =\s*"([0-9a-f]{64})"/.exec(
      selector,
    )?.[1];
    const selectorAllowlist = [
      ...(
        /const scrubColumnAllowlist = new Set\(\s*\[([\s\S]*?)\]\.map/.exec(
          selector,
        )?.[1] ?? ""
      ).matchAll(/"([a-z_]+\.[a-z_]+)"/g),
    ].map((match) => `public.${match[1]}`);
    expect(
      Object.values(CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST).flat(),
    ).toHaveLength(selectorAllowlist.length);
    expect(
      Object.entries(CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST)
        .flatMap(([table, columns]) => columns.map((c) => `${table}.${c}`))
        .sort(),
    ).toEqual([...selectorAllowlist].sort());

    const baseline = await baselineSnapshot();
    const result = await transformCandidateCopySnapshot(baseInput(baseline));
    const proof = result.selectorPreservation;
    expect(proof).toEqual(
      toSelectorPreservationProof(catalogue, result.candidateInspection),
    );
    expect(Object.keys(proof)).toEqual(["schemaFingerprint", "tables"]);
    expect(proof.schemaFingerprint).toBe(selectorHash);
    expect(proof.tables).toHaveLength(184);
    expect(
      proof.tables.map(({ schema, table, columns }) => ({
        schema,
        table,
        columns,
      })),
    ).toEqual(catalogue);
    const baselineProof = toSelectorPreservationProof(
      catalogue,
      result.baselineInspection,
    );
    for (const [index, entry] of proof.tables.entries()) {
      const name = `${entry.schema}.${entry.table}`;
      expect(Object.keys(entry)).toEqual([
        "schema",
        "table",
        "columns",
        "excludedColumns",
        "rowCount",
        "protectedFingerprint",
      ]);
      expect(Number.isInteger(entry.rowCount) && entry.rowCount >= 0).toBe(
        true,
      );
      expect(entry.protectedFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(new Set(entry.excludedColumns).size).toBe(
        entry.excludedColumns.length,
      );
      for (const column of entry.excludedColumns) {
        expect(entry.columns).toContain(column);
        expect(selectorAllowlist).toContain(`${name}.${column}`);
      }
      // The selector's preserved-data comparison: same columns and exclusions, and
      // equal rows and fingerprint for every non-transient table.
      const before = baselineProof.tables[index];
      expect(entry.excludedColumns).toEqual(before?.excludedColumns);
      if (name in CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST) continue;
      if (
        (CANDIDATE_COPY_SCRUB_DELETABLE_TABLES as readonly string[]).includes(
          name,
        )
      ) {
        expect(entry.rowCount).toBe(0);
      } else {
        expect(entry.rowCount).toBe(before?.rowCount);
        expect(entry.protectedFingerprint).toBe(before?.protectedFingerprint);
      }
    }
    expect(
      proof.tables.find((entry) => entry.table === "webhook")?.excludedColumns,
    ).toEqual([
      "secret",
      "secret_previous",
      "active",
      "disabled_at",
      "disabled_reason",
    ]);
  });

  it("transforms a real-schema snapshot into an inert candidate with exact proofs", async () => {
    const baseline = await baselineSnapshot();
    const result = await transformCandidateCopySnapshot(baseInput(baseline));

    expect(rowsOf(baseline, "public.session")).toHaveLength(1);
    expect(rowsOf(baseline, "public.account")[0]?.access_token).toBe(
      "oauth-live-access-token-011",
    );
    expect(
      rowsOf(baseline, "public.instance_plugin_config").map((r) => r.enabled),
    ).toEqual([true, true, true]);
    const out = result.snapshot;
    expect(Object.keys(out.tables)).toHaveLength(184);
    for (const table of CANDIDATE_COPY_SCRUB_DELETABLE_TABLES) {
      expect(rowsOf(out, table)).toHaveLength(0);
    }
    expect(rowsOf(out, "public.account")[0]).toMatchObject({
      access_token: null,
      password: "$argon2id$preserved",
    });
    expect(
      rowsOf(out, "public.api_key").map((r) => [
        r.apikey_id,
        r.disabled_reason,
      ]),
    ).toEqual([
      ["ws-key-active", "candidate_copy_scrub"],
      ["ws-key-disabled", "prior_incident"],
    ]);
    expect(
      rowsOf(out, "public.instance_plugin_config").map((r) => [
        r.id,
        r.enabled,
      ]),
    ).toEqual([
      ["plugin-password", true],
      ["plugin-magic-link", false],
      ["plugin-slack-1", false],
    ]);
    expect(rowsOf(out, "public.automation_run").map((r) => r.state)).toEqual([
      "abandoned",
      "done",
    ]);
    expect(rowsOf(out, "public.import_run").map((r) => r.state)).toEqual([
      "failed",
      "completed",
    ]);
    expect(
      rowsOf(out, "public.notification_delivery").map((r) => r.state),
    ).toEqual(["suppressed", "delivered"]);

    const plaintext = await symmetricDecrypt({
      key: CANDIDATE_AUTH,
      data: rowsOf(out, "public.two_factor")[0]?.secret as string,
    });
    expect(plaintext).toBe("AAAAAAAAAAAAAAAABBBBBBBBBBBBBBBB");
    expect(
      buildInertCandidateSecretPlaintext("webhook", "wh-1", "secret"),
    ).toMatch(/^tdk-candidate-inert-v1-webhook-/);

    expect(result.credentialsProof.enabledExternalPluginConfigs).toBe(0);
    expect(result.selectorOutbound).toMatchObject({
      enabledExternalPlugins: 0,
      runnableJobHandlers: 0,
    });
    expect("enabledPlugins" in result.selectorOutbound).toBe(false);
    const selectorOutboundKeys = [
      ...(
        /const zeroOutboundCounts = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(
          readFileSync(
            path.join(repoRoot, "deploy/local-candidate-selection.mjs"),
            "utf8",
          ),
        )?.[1] ?? ""
      ).matchAll(/^\s*"([A-Za-z]+)",/gm),
    ].map((match) => match[1]);
    expect(selectorOutboundKeys).toContain("enabledExternalPlugins");
    expect(selectorOutboundKeys).not.toContain("enabledPlugins");
    expect(Object.keys(result.selectorOutbound).sort()).toEqual(
      [...selectorOutboundKeys].sort(),
    );
    expect(result.selectorIntrinsicAuth).toEqual({
      allowedPluginIds: ["auth.password"],
      storedPasswordRows: 1,
      enabledPasswordRows: 1,
      agentPasswordEnabled: true,
      customerPasswordEnabled: true,
    });
    expect(result.candidateInspection.intrinsicAuthState).toEqual(
      result.baselineInspection.intrinsicAuthState,
    );
    expect(result.mfaProof).toEqual({
      mode: "reencrypted",
      storedRows: 1,
      enabledUsers: 1,
      candidateReadableRows: 1,
      baselineReadableRows: 0,
    });
    expect(result.candidateInspection.tables["public.person"]).toMatchObject({
      observation: "rows",
      rowCount: 1,
    });
    expect(result.candidateInspection.tables["public.work_item"]).toMatchObject(
      { observation: "digest-only", rowCount: 3 },
    );
    expect(result.summary).toMatchObject({
      tdk1RecryptedRows: 2,
      encV2RecryptedValues: 4,
      twoFactorRecryptedRows: 1,
      preservedTableCount: 159,
    });

    const serialised = JSON.stringify({ ...result, snapshot: undefined });
    for (const marker of MARKERS) expect(serialised).not.toContain(marker);
  });

  describe("H1: schema validation fails closed", () => {
    it("rejects a snapshot without a catalogue hash and a wrong hash", async () => {
      const baseline = await baselineSnapshot();
      const { catalogueHash: _omitted, ...missing } = baseline;
      for (const snapshot of [
        missing,
        { ...baseline, catalogueHash: "0".repeat(64) },
      ]) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput(snapshot as CandidateCopyDatabaseSnapshot),
          ),
        );
        expect(error.code).toBe("SCHEMA_CATALOGUE_DRIFT");
      }
    });

    it("rejects a 25-table snapshot (managed tables only)", async () => {
      const baseline = await baselineSnapshot();
      const managedOnly = Object.fromEntries(
        Object.entries(baseline.tables).filter(
          ([, state]) => "rows" in state && state.rows !== undefined,
        ),
      );
      const error = await rejection(
        transformCandidateCopySnapshot(
          baseInput({ ...baseline, tables: managedOnly }),
        ),
      );
      expect(error.code).toBe("SCHEMA_CATALOGUE_DRIFT");
    });

    it("rejects missing and extra tables, columns and row keys", async () => {
      const baseline = await baselineSnapshot();
      const { "public.work_item": _dropped, ...withoutTable } = baseline.tables;
      const cases: CandidateCopyDatabaseSnapshot[] = [
        { ...baseline, tables: withoutTable },
        {
          ...baseline,
          tables: {
            ...baseline.tables,
            "public.invented": {
              columns: ["id"],
              observation: "digest-only",
              rowCount: 0,
              protectedFingerprint: digestOf("public.invented"),
            },
          },
        },
        patch(baseline, "public.account", 0, { surprise_column: "x" }),
        edit(baseline, "public.account", (rows) => [
          Object.fromEntries(
            Object.entries(rows[0] as CandidateCopyRow).filter(
              ([key]) => key !== "password",
            ),
          ),
        ]),
        {
          ...baseline,
          tables: {
            ...baseline.tables,
            "public.work_item": {
              ...(baseline.tables["public.work_item"] as object),
              columns: [...columnsOf("public.work_item"), "extra"],
            } as unknown as CandidateCopyTableState,
          },
        },
        {
          ...baseline,
          tables: {
            ...baseline.tables,
            "public.work_item": {
              ...(baseline.tables["public.work_item"] as object),
              columns: columnsOf("public.work_item").slice(1),
            } as unknown as CandidateCopyTableState,
          },
        },
      ];
      for (const snapshot of cases) {
        const error = await rejection(
          transformCandidateCopySnapshot(baseInput(snapshot)),
        );
        expect(error.code).toBe("SCHEMA_CATALOGUE_DRIFT");
      }
    });

    it("rejects an unreviewed or truncated catalogue input", async () => {
      const baseline = await baselineSnapshot();
      for (const supplied of [catalogue.slice(1), [], undefined]) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput(baseline, {
              catalogue: supplied as unknown as typeof catalogue,
            }),
          ),
        );
        expect(["SCHEMA_CATALOGUE_DRIFT", "INVALID_INPUT"]).toContain(
          error.code,
        );
      }
    });
  });

  describe("H2: runtime job state is never inferred from rows", () => {
    it("requires an explicit runtime observation even when every job row is disabled", async () => {
      const baseline = await baselineSnapshot();
      const disabled = patch(baseline, "public.instance_job_configuration", 0, {
        enabled: false,
      });
      for (const runtimeObservation of [
        undefined,
        { ...RUNTIME, slot: "another-slot" },
        { ...RUNTIME, runnableJobHandlers: Number.NaN },
        { ...RUNTIME, source: "effective-runtime" },
        { ...RUNTIME, candidateImageDigest: undefined },
        { ...RUNTIME, candidateImageDigest: "sha256:abc" },
        { ...RUNTIME, candidateImageDigest: "a".repeat(64) },
        { ...RUNTIME, candidateEnvFingerprint: "xyz" },
        { ...RUNTIME, candidateEnvFingerprint: "B".repeat(64) },
        { ...RUNTIME, runtimeRole: "all" },
        { ...RUNTIME, runtimeRole: "candidate-readonly" },
        { ...RUNTIME, candidateReadOnly: undefined },
        { ...RUNTIME, candidateReadOnly: "true" },
        { ...RUNTIME, networkExternalEgressBlocked: "yes" },
      ]) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput(disabled, {
              runtimeObservation:
                runtimeObservation as unknown as typeof RUNTIME,
            }),
          ),
        );
        expect(error.code).toBe("RUNTIME_PROOF_REQUIRED");
      }
    });

    it("fails closed on runnable handlers or an enabled web invitation poller", async () => {
      const baseline = await baselineSnapshot();
      for (const runtimeObservation of [
        { ...RUNTIME, runnableJobHandlers: 3 },
        { ...RUNTIME, webInvitationPollerEnabled: true },
        { ...RUNTIME, candidateReadOnly: false },
        { ...RUNTIME, networkExternalEgressBlocked: false },
        { ...RUNTIME, autonomousWorkersDisabled: false },
        { ...RUNTIME, nonPasswordLocalAuthDisabled: false },
      ]) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput(baseline, { runtimeObservation }),
          ),
        );
        expect(error.code).toBe("INVARIANT_VIOLATION");
      }
    });

    it("keeps configuration-row counts separate from the runtime figure", async () => {
      const baseline = await baselineSnapshot();
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      expect(result.outboundProof.enabledInstanceJobs).toBe(0);
      expect(result.selectorOutbound.runnableJobHandlers).toBe(
        RUNTIME.runnableJobHandlers,
      );
      // A baseline with no configuration rows at all still needs the observation.
      const noRows = edit(
        baseline,
        "public.instance_job_configuration",
        () => [],
      );
      const error = await rejection(
        transformCandidateCopySnapshot(
          baseInput(noRows, {
            runtimeObservation: undefined as unknown as typeof RUNTIME,
          }),
        ),
      );
      expect(error.code).toBe("RUNTIME_PROOF_REQUIRED");
    });
  });

  describe("M1: real physical keys and constraint values", () => {
    it("rejects invented identifiers as unknown columns", async () => {
      const baseline = await baselineSnapshot();
      const invented: [string, CandidateCopyRow][] = [
        ["public.api_key", { id: "x" }],
        ["public.scim_connection", { id: "x" }],
        ["public.instance_job_configuration", { job_key: "x" }],
        ["public.outbox", { id: "x" }],
        ["public.instance_setting", { singleton: true }],
        ["public.api_key", { revoked_at: null }],
      ];
      for (const [table, extra] of invented) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput(patch(baseline, table, 0, extra)),
          ),
        );
        expect(error.code).toBe("SCHEMA_CATALOGUE_DRIFT");
      }
    });

    it("rejects state values outside the database constraints", async () => {
      const baseline = await baselineSnapshot();
      const invented: [string, string][] = [
        ["public.notification_delivery", "sent"],
        ["public.automation_run", "succeeded"],
        ["public.import_run", "cancelled"],
        ["public.import_run", "completed_with_errors"],
        ["public.outbox", "failed"],
        ["public.webhook_delivery", "sent"],
      ];
      for (const [table, state] of invented) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput(patch(baseline, table, 0, { state })),
          ),
        );
        expect(error.code).toBe("INVALID_INPUT");
      }
    });

    it("rejects duplicate or missing primary keys", async () => {
      const baseline = await baselineSnapshot();
      for (const [table, pk, other] of [
        ["public.outbox", "event_id", "ev-dead"],
        ["public.api_key", "apikey_id", "ws-key-disabled"],
      ] as const) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput(patch(baseline, table, 0, { [pk]: other })),
          ),
        );
        expect(error.code).toBe("INVALID_INPUT");
      }
    });
  });

  describe("M2: intrinsic password versus external plugins", () => {
    const pluginTable = "public.instance_plugin_config";

    it("fails closed when agent password is disabled in the baseline", async () => {
      const baseline = await baselineSnapshot();
      const error = await rejection(
        transformCandidateCopySnapshot(
          baseInput(patch(baseline, pluginTable, 0, { enabled: false })),
        ),
      );
      expect(error).toMatchObject({ code: "INVARIANT_VIOLATION" });
    });

    it("treats a non-intrinsic password row as external, disabling it and failing the equality check", async () => {
      const baseline = await baselineSnapshot();
      const error = await rejection(
        transformCandidateCopySnapshot(
          baseInput(patch(baseline, pluginTable, 0, { workspace_id: "ws-1" })),
        ),
      );
      expect(error.code).toBe("INVARIANT_VIOLATION");
    });

    it("keeps an intrinsic password row enabled but still rotates its secret to inert", async () => {
      const baseline = await baselineSnapshot();
      const sealed = withKey(BASELINE_ENC, () =>
        encryptIdentityClientSecret(
          "plugin-password",
          "password-plugin-secret",
        ),
      );
      const result = await transformCandidateCopySnapshot(
        baseInput(patch(baseline, pluginTable, 0, { secrets: sealed })),
      );
      const passwordRow = rowsOf(result.snapshot, pluginTable)[0];
      expect(passwordRow?.enabled).toBe(true);
      expect(passwordRow?.secrets).not.toEqual(sealed);
      expect(result.summary.tdk1RecryptedRows).toBe(3);
      expect(result.outboundProof.usablePluginSecrets).toBe(0);
    });

    it("reports a customer-disabled password state unchanged", async () => {
      const baseline = await baselineSnapshot();
      const scoped = edit(baseline, pluginTable, (rows) => [
        { ...(rows[0] as CandidateCopyRow), portal_scope: "agent" },
        ...rows.slice(1),
      ]);
      const result = await transformCandidateCopySnapshot(baseInput(scoped));
      expect(result.selectorIntrinsicAuth.customerPasswordEnabled).toBe(false);
      expect(result.selectorIntrinsicAuth.agentPasswordEnabled).toBe(true);
    });

    it("rejects a candidate that re-enables an external plugin or disables password", async () => {
      const baseline = await baselineSnapshot();
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      const verify = (candidate: CandidateCopyDatabaseSnapshot) =>
        verifyTransformedCandidateCopySnapshot({
          ...baseInput(baseline),
          baselineSnapshot: baseline,
          candidateSnapshot: candidate,
        });
      for (const [index, enabled] of [
        [2, true],
        [1, true],
        [0, false],
      ] as const) {
        await expect(
          verify(patch(result.snapshot, pluginTable, index, { enabled })),
        ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });
      }
    });
  });

  describe("M3: supplied metadata never overrides rows", () => {
    it("recomputes row-backed counts and fingerprints and rejects disagreeing metadata", async () => {
      const baseline = await baselineSnapshot();
      const columns = columnsOf("public.person");
      const personRows = rowsOf(baseline, "public.person");
      const honest = inspectCandidateCopySnapshot({
        ...baseInput(baseline),
        snapshot: baseline,
      });
      const personFingerprint = honest.tables["public.person"]
        ?.protectedFingerprint as string;
      expect(personFingerprint).toBe(
        computeProtectedTableFingerprint("public.person", personRows, []),
      );
      for (const metadata of [
        { rowCount: 99 },
        { protectedFingerprint: "f".repeat(64) },
      ]) {
        const forged = {
          ...baseline,
          tables: {
            ...baseline.tables,
            "public.person": { columns, rows: personRows, ...metadata },
          },
        };
        const error = await rejection(
          transformCandidateCopySnapshot(baseInput(forged)),
        );
        expect(error.code).toBe("INVALID_INPUT");
      }
      const consistent = {
        ...baseline,
        tables: {
          ...baseline.tables,
          "public.person": {
            columns,
            rows: personRows,
            rowCount: 1,
            protectedFingerprint: personFingerprint,
          },
        },
      };
      await expect(
        transformCandidateCopySnapshot(baseInput(consistent)),
      ).resolves.toBeDefined();
    });

    it("distinguishes digest-only observations and validates them", async () => {
      const baseline = await baselineSnapshot();
      const digest = baseline.tables[
        "public.work_item"
      ] as CandidateCopyTableState;
      const cases: CandidateCopyTableState[] = [
        {
          ...digest,
          protectedFingerprint: "not-hex",
        } as CandidateCopyTableState,
        { ...digest, rowCount: -1 } as CandidateCopyTableState,
        {
          ...digest,
          observation: undefined,
        } as unknown as CandidateCopyTableState,
        {
          ...digest,
          rows: [],
        } as unknown as CandidateCopyTableState,
      ];
      for (const state of cases) {
        const error = await rejection(
          transformCandidateCopySnapshot(
            baseInput({
              ...baseline,
              tables: { ...baseline.tables, "public.work_item": state },
            }),
          ),
        );
        expect(error.code).toBe("INVALID_INPUT");
      }
      const managedDigest = {
        ...baseline,
        tables: {
          ...baseline.tables,
          "public.account": {
            columns: columnsOf("public.account"),
            observation: "digest-only",
            rowCount: 1,
            protectedFingerprint: digestOf("public.account"),
          } as CandidateCopyTableState,
        },
      };
      const error = await rejection(
        transformCandidateCopySnapshot(baseInput(managedDigest)),
      );
      expect(error.code).toBe("INVALID_INPUT");
    });

    it("detects a changed preserved row through the recomputed fingerprint", async () => {
      const baseline = await baselineSnapshot();
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      const tampered = patch(result.snapshot, "public.person", 0, {
        user_id: "someone-else",
      });
      const error = await rejection(
        verifyTransformedCandidateCopySnapshot({
          ...baseInput(baseline),
          baselineSnapshot: baseline,
          candidateSnapshot: tampered,
        }),
      );
      expect(error.code).toBe("INVARIANT_VIOLATION");
    });
  });

  describe("M4: transaction ownership and persisted verification", () => {
    type Mode =
      | "faithful"
      | "reordered"
      | "noop"
      | "partial"
      | "downgrade"
      | "aliased";
    function boundaryFor(initial: CandidateCopyDatabaseSnapshot, mode: Mode) {
      const state = {
        stored: initial,
        rolledBack: false,
        applied: 0,
        lastApplied: undefined as CandidateCopyDatabaseSnapshot | undefined,
      };
      const boundary: CandidateCopyTransactionalBoundary<string> = {
        async runInTransaction(work) {
          const before = state.stored;
          try {
            return await work({
              loadSnapshot: async () => state.stored,
              applyTransformedSnapshot: async (snapshot) => {
                state.applied += 1;
                state.lastApplied = snapshot;
                if (mode === "noop") return "receipt";
                if (mode === "partial") {
                  state.stored = {
                    ...state.stored,
                    tables: {
                      ...state.stored.tables,
                      "public.account": snapshot.tables[
                        "public.account"
                      ] as never,
                    },
                  };
                  return "receipt";
                }
                state.stored = structuredClone(snapshot);
                if (mode === "reordered") {
                  for (const table of ["public.apikey", "public.api_key"]) {
                    const stored = state.stored.tables[
                      table
                    ] as CandidateCopyRowBackedTable;
                    (stored.rows as CandidateCopyRow[]).reverse();
                  }
                }
                return "receipt";
              },
              reloadSnapshot: async () => {
                if (mode === "aliased") return state.lastApplied as never;
                if (mode !== "downgrade") return state.stored;
                const person = (
                  state.stored.tables[
                    "public.person"
                  ] as CandidateCopyRowBackedTable
                ).rows;
                return {
                  ...state.stored,
                  tables: {
                    ...state.stored.tables,
                    "public.person": {
                      columns: columnsOf("public.person"),
                      observation: "digest-only",
                      rowCount: person.length,
                      protectedFingerprint: computeProtectedTableFingerprint(
                        "public.person",
                        person,
                        [],
                      ),
                    },
                  },
                };
              },
            });
          } catch (error) {
            state.stored = before;
            state.rolledBack = true;
            throw error;
          }
        },
      };
      return { boundary, state };
    }
    const { snapshot: _snapshot, ...transactionInput } = baseInput(
      undefined as unknown as CandidateCopyDatabaseSnapshot,
    );

    it("accepts a faithful apply, including reordered rows, and returns persisted proofs", async () => {
      for (const mode of ["faithful", "reordered"] as const) {
        const { boundary, state } = boundaryFor(await baselineSnapshot(), mode);
        const result = await applyCandidateCopyTransformInTransaction(
          boundary,
          transactionInput,
        );
        expect(result.commitReceipt).toBe("receipt");
        expect(result.snapshot).toBe(state.stored);
        expect(result.selectorCredentials.activeApiKeys).toBe(0);
        expect(state.rolledBack).toBe(false);
      }
    });

    it("rejects and rolls back a no-op or partial apply", async () => {
      for (const mode of ["noop", "partial"] as const) {
        const { boundary, state } = boundaryFor(await baselineSnapshot(), mode);
        const error = await rejection(
          applyCandidateCopyTransformInTransaction(boundary, transactionInput),
        );
        expect(error.code).toBe("INVARIANT_VIOLATION");
        expect(state.rolledBack).toBe(true);
        expect(rowsOf(state.stored, "public.account")[0]?.access_token).toBe(
          "oauth-live-access-token-011",
        );
      }
    });

    it("rejects a rows-to-digest-only downgrade on reload (R4)", async () => {
      const { boundary, state } = boundaryFor(
        await baselineSnapshot(),
        "downgrade",
      );
      const error = await rejection(
        applyCandidateCopyTransformInTransaction(boundary, transactionInput),
      );
      expect(error).toMatchObject({ code: "INVARIANT_VIOLATION" });
      expect(error.message).toContain("Observation kind");
      expect(state.rolledBack).toBe(true);
    });

    it("rejects a reload that aliases in-memory snapshots (R2)", async () => {
      const { boundary, state } = boundaryFor(
        await baselineSnapshot(),
        "aliased",
      );
      const error = await rejection(
        applyCandidateCopyTransformInTransaction(boundary, transactionInput),
      );
      expect(error).toMatchObject({ code: "INVARIANT_VIOLATION" });
      expect(error.message).toContain("in-memory data");
      expect(state.rolledBack).toBe(true);
    });

    it("rejects row-level aliasing with the baseline or prepared rows", async () => {
      const baseline = await baselineSnapshot();
      for (const source of ["baseline", "prepared"] as const) {
        const state = { stored: baseline };
        const boundary: CandidateCopyTransactionalBoundary<string> = {
          runInTransaction: (work) =>
            work({
              loadSnapshot: async () => baseline,
              applyTransformedSnapshot: async (snapshot) => {
                state.stored = structuredClone(snapshot);
                const shared = (
                  (source === "baseline" ? baseline : snapshot).tables[
                    "public.person"
                  ] as CandidateCopyRowBackedTable
                ).rows;
                (
                  state.stored.tables["public.person"] as {
                    rows: readonly CandidateCopyRow[];
                  }
                ).rows = [...shared];
                return "receipt";
              },
              reloadSnapshot: async () => state.stored,
            }),
        };
        const error = await rejection(
          applyCandidateCopyTransformInTransaction(boundary, transactionInput),
        );
        expect(error.message).toContain("row object");
      }
    });

    it("never applies when preparation fails", async () => {
      const { boundary, state } = boundaryFor(
        await baselineSnapshot(),
        "faithful",
      );
      await rejection(
        applyCandidateCopyTransformInTransaction(boundary, {
          ...transactionInput,
          runtimeObservation: undefined as unknown as typeof RUNTIME,
        }),
      );
      expect(state.applied).toBe(0);
      expect(state.rolledBack).toBe(true);
    });
  });

  describe("M4: stored versus runtime-suppressed non-password auth", () => {
    const pluginTable = "public.instance_plugin_config";
    it("reports defaults when no magic-link or email-otp rows exist", async () => {
      const baseline = edit(await baselineSnapshot(), pluginTable, (rows) =>
        rows.filter((row) => row.plugin_id !== "auth.magic-link"),
      );
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      expect(result.localAuthResolutionProof).toEqual({
        agentStoredPasswordEnabled: true,
        customerStoredPasswordEnabled: true,
        enabledNonPasswordAuthPluginRows: 0,
        agentStoredMagicLinkDefaultedWithoutRow: true,
        agentStoredEmailOtpDefaultedWithoutRow: true,
        nonPasswordLocalAuthSuppressedByRuntimeRole: true,
      });
      expect(Object.keys(result.selectorIntrinsicAuth).sort()).toEqual([
        "agentPasswordEnabled",
        "allowedPluginIds",
        "customerPasswordEnabled",
        "enabledPasswordRows",
        "storedPasswordRows",
      ]);
      expect(
        Object.keys(result.candidateInspection.intrinsicAuthState).sort(),
      ).toEqual([
        "agentPasswordEnabled",
        "customerPasswordEnabled",
        "enabledPasswordRows",
        "storedPasswordRows",
      ]);
    });

    it("reports rows disabled by the transform when explicit rows were enabled", async () => {
      const baseline = edit(await baselineSnapshot(), pluginTable, (rows) => [
        ...rows,
        row(pluginTable, {
          id: "plugin-email-otp",
          plugin_id: "auth.email-otp",
          instance_key: "default",
          enabled: true,
          scope: "instance",
          portal_scope: "agent",
        }),
      ]);
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      expect(result.localAuthResolutionProof).toMatchObject({
        enabledNonPasswordAuthPluginRows: 0,
        agentStoredMagicLinkDefaultedWithoutRow: false,
        agentStoredEmailOtpDefaultedWithoutRow: false,
      });
    });

    it("rejects a candidate that leaves an auth plugin row enabled", async () => {
      const baseline = await baselineSnapshot();
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      await expect(
        verifyTransformedCandidateCopySnapshot({
          ...baseInput(baseline),
          baselineSnapshot: baseline,
          candidateSnapshot: patch(result.snapshot, pluginTable, 1, {
            enabled: true,
          }),
        }),
      ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });
    });
  });

  describe("L2/L4/L5 hardening", () => {
    it("computes envelope counters from checks, not literals", async () => {
      const baseline = await baselineSnapshot();
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      expect(result.selectorCredentials.oldKeyEnvelopes).toBe(0);
      expect(result.selectorCredentials.unreadableEnvelopes).toBe(0);
      expect(result.mfaProof.baselineReadableRows).toBe(0);
      // A candidate whose secret is still readable under the baseline key fails closed.
      await expect(
        verifyTransformedCandidateCopySnapshot({
          ...baseInput(baseline),
          baselineSnapshot: baseline,
          candidateSnapshot: patch(result.snapshot, "public.two_factor", 0, {
            secret: rowsOf(baseline, "public.two_factor")[0]?.secret,
          }),
        }),
      ).rejects.toMatchObject({ table: "public.two_factor" });
    });

    it("fingerprints identically regardless of locale and without tag collisions", () => {
      const rows = [
        { b: "Z", a: "a" },
        { b: "ä", a: "B" },
      ];
      const first = computeProtectedTableFingerprint("t", rows, []);
      const spy = vi
        .spyOn(String.prototype, "localeCompare")
        .mockImplementation(() => {
          throw new Error("locale-dependent comparison used");
        });
      const second = computeProtectedTableFingerprint("t", rows, []);
      spy.mockRestore();
      expect(second).toBe(first);
      const date = new Date("2026-01-01T00:00:00.000Z");
      const lookalikes = [
        { v: date },
        { v: { $type: "Date", value: date.toISOString() } },
        { v: ["date", date.toISOString()] },
        { v: date.toISOString() },
        { v: Buffer.from("ab", "hex") },
        { v: { $type: "Bytes", value: "ab" } },
        { v: ["bytes", "ab"] },
      ].map((value) => computeProtectedTableFingerprint("t", [value], []));
      expect(new Set(lookalikes).size).toBe(lookalikes.length);
    });

    it("never derives inert secrets from (table,row,column) alone", async () => {
      const baseline = await baselineSnapshot();
      const guess = buildInertCandidateSecretPlaintext(
        "webhook",
        "wh-1",
        "secret",
      );
      const results = await Promise.all([
        transformCandidateCopySnapshot(baseInput(baseline)),
        transformCandidateCopySnapshot(baseInput(baseline)),
      ]);
      // Ciphertexts carry fresh IVs, so compare what the candidate key decrypts to.
      const plain = results.map((result) =>
        withKey(CANDIDATE_ENC, () =>
          decryptSecret(
            rowsOf(result.snapshot, "public.webhook")[0]?.secret as string,
          ),
        ),
      );
      expect(plain[0]).not.toBe(plain[1]);
      for (const value of plain) {
        expect(value).toMatch(/^tdk-candidate-inert-v1-webhook-[0-9a-f]{32}$/);
        expect(value).not.toBe(guess);
      }
    });
  });

  describe("cryptographic fail-closed behaviour", () => {
    const cases: [
      string,
      string,
      string,
      (
        snapshot: CandidateCopyDatabaseSnapshot,
      ) => CandidateCopyDatabaseSnapshot,
      string,
    ][] = [
      [
        "unknown TDK header",
        "public.identity_connection",
        "client_secret",
        (snapshot) =>
          edit(snapshot, "public.identity_connection", (rows) => {
            const secret = Buffer.from(rows[0]?.client_secret as Buffer);
            secret.write("TDK2", 0, "ascii");
            rows[0] = { ...rows[0], client_secret: secret };
            return rows;
          }),
        "UNKNOWN_ENVELOPE_VERSION",
      ],
      [
        "legacy enc:v1 webhook",
        "public.webhook",
        "secret",
        (snapshot) =>
          patch(snapshot, "public.webhook", 0, {
            secret: "enc:v1:aaaa.bbbb.cccc",
          }),
        "UNKNOWN_ENVELOPE_VERSION",
      ],
      [
        "plaintext notification token",
        "public.user_notification_preference",
        "ntfy_token",
        (snapshot) =>
          patch(snapshot, "public.user_notification_preference", 0, {
            ntfy_token: "plaintext-not-encrypted",
          }),
        "UNKNOWN_ENVELOPE_VERSION",
      ],
      [
        "ciphertext bound to another row id",
        "public.instance_plugin_config",
        "secrets",
        (snapshot) =>
          patch(snapshot, "public.instance_plugin_config", 2, {
            id: "plugin-other",
          }),
        "OLD_KEY_DECRYPT_FAILED",
      ],
      [
        "blank row id used as AAD",
        "public.identity_connection",
        "id",
        (snapshot) =>
          patch(snapshot, "public.identity_connection", 0, { id: "  " }),
        "MISSING_AAD",
      ],
      [
        "tampered TOTP secret",
        "public.two_factor",
        "secret",
        (snapshot) =>
          edit(snapshot, "public.two_factor", (rows) => {
            const secret = rows[0]?.secret as string;
            rows[0] = {
              ...rows[0],
              secret: secret.slice(0, -1) + (secret.endsWith("0") ? "1" : "0"),
            };
            return rows;
          }),
        "OLD_KEY_DECRYPT_FAILED",
      ],
      [
        "delivery envelope bound to another credential hash",
        "public.customer_invitation_delivery",
        "envelope",
        (snapshot) =>
          patch(snapshot, "public.customer_invitation_delivery", 0, {
            credential_hash: "cc".repeat(32),
          }),
        "OLD_KEY_DECRYPT_FAILED",
      ],
    ];

    it.each(cases)("rejects %s", async (_name, table, column, mutate, code) => {
      const error = await rejection(
        transformCandidateCopySnapshot(
          baseInput(mutate(await baselineSnapshot())),
        ),
      );
      expect(error).toMatchObject({ code, table, column });
    });

    it("forbids key reuse and previous-key fallbacks", async () => {
      const baseline = await baselineSnapshot();
      for (const [overrides, code] of [
        [{ candidateEncryptionKey: BASELINE_ENC }, "KEY_REUSE_FORBIDDEN"],
        [{ candidateAuthSecret: BASELINE_AUTH }, "KEY_REUSE_FORBIDDEN"],
        [{ baselineEncryptionKeyPrevious: "33".repeat(32) }, "INVALID_INPUT"],
        [{ candidateEncryptionKeyPrevious: "33".repeat(32) }, "INVALID_INPUT"],
      ] as const) {
        const error = await rejection(
          transformCandidateCopySnapshot(baseInput(baseline, overrides)),
        );
        expect(error.code).toBe(code);
      }
    });

    it("rejects a candidate with a modified protected column or a usable secret", async () => {
      const baseline = await baselineSnapshot();
      const result = await transformCandidateCopySnapshot(baseInput(baseline));
      const verify = (candidate: CandidateCopyDatabaseSnapshot) =>
        verifyTransformedCandidateCopySnapshot({
          ...baseInput(baseline),
          baselineSnapshot: baseline,
          candidateSnapshot: candidate,
        });
      const modified = patch(result.snapshot, "public.account", 0, {
        password: "$argon2id$changed",
      });
      await expect(verify(modified)).rejects.toMatchObject({
        code: "INVARIANT_VIOLATION",
        column: "password",
      });
      const usable = patch(result.snapshot, "public.webhook", 0, {
        secret: rowsOf(baseline, "public.webhook")[0]?.secret,
      });
      await expect(verify(usable)).rejects.toMatchObject({
        code: "NEW_KEY_VERIFY_FAILED",
        table: "public.webhook",
      });
      const liveSession = edit(result.snapshot, "public.session", () => [
        row("public.session", { id: "sess-1" }),
      ]);
      await expect(verify(liveSession)).rejects.toMatchObject({
        code: "INVARIANT_VIOLATION",
      });
    });

    it("never leaks keys or plaintext in error messages", async () => {
      const baseline = await baselineSnapshot();
      const error = await rejection(
        transformCandidateCopySnapshot(
          baseInput(
            patch(baseline, "public.webhook", 0, { secret: "enc:v1:x.y.z" }),
          ),
        ),
      );
      for (const marker of MARKERS) {
        expect(`${error.message} ${error.table} ${error.column}`).not.toContain(
          marker,
        );
      }
    });
  });
});

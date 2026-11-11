import { createHash, randomBytes } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { reencryptDeliveryEnvelope } from "../customer-invitation/delivery/envelope.js";
import {
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
  envelopeKeyId,
} from "../identity/client-secret.js";
import {
  decryptSecret,
  encryptSecret,
} from "../notification-preferences/secrets.js";
import { resolveAuthSecret } from "../utils/require-auth-secret.js";

export const CANDIDATE_COPY_REVIEWED_CATALOGUE_HASH =
  "5527479fdc0b90c18d06f3fb0c19a1ae84d6f0950f5b8fdcfcca6f79ff254b98" as const;

export const CANDIDATE_COPY_SCRUB_DELETABLE_TABLES = Object.freeze([
  "public.session",
  "public.verification",
  "public.step_up_confirmation",
  "public.customer_invitation_auth_continuation",
] as const);

export const CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST = Object.freeze({
  "public.account": Object.freeze([
    "access_token",
    "refresh_token",
    "id_token",
  ]),
  "public.apikey": Object.freeze(["enabled"]),
  "public.api_key": Object.freeze(["disabled_at", "disabled_reason"]),
  "public.two_factor": Object.freeze(["secret", "backup_codes"]),
  "public.instance_plugin_config": Object.freeze(["secrets", "enabled"]),
  "public.identity_connection": Object.freeze(["client_secret", "enabled"]),
  "public.scim_connection": Object.freeze([
    "token_hash",
    "token_prefix",
    "enabled",
  ]),
  "public.instance_setting": Object.freeze([
    "metrics_token_hash",
    "metrics_token_rotated_at",
    "setup_token_hash",
    "setup_token_expires_at",
  ]),
  "public.webhook": Object.freeze([
    "secret",
    "secret_previous",
    "active",
    "disabled_at",
    "disabled_reason",
  ]),
  "public.user_notification_preference": Object.freeze([
    "ntfy_token",
    "gotify_token",
    "webhook_secret",
  ]),
  "public.import_source_connection": Object.freeze(["credential_ciphertext"]),
  "public.customer_invitation_delivery": Object.freeze([
    "envelope",
    "credential_hash",
    "owner_id",
    "lease_id",
    "lease_expires_at",
    "state",
    "terminal_code",
    "updated_at",
  ]),
  "public.invitation": Object.freeze(["credential_hash", "status"]),
  "public.automation": Object.freeze(["enabled"]),
  "public.instance_job_configuration": Object.freeze(["enabled"]),
  "public.outbox": Object.freeze(["state"]),
  "public.notification_delivery": Object.freeze(["state"]),
  "public.webhook_delivery": Object.freeze(["state"]),
  "public.automation_run": Object.freeze(["state"]),
  "public.import_run": Object.freeze(["state"]),
} as const);

const ALLOWLIST: Readonly<Record<string, readonly string[]>> =
  CANDIDATE_COPY_SCRUB_COLUMN_ALLOWLIST;

/**
 * The 25 tables this transform rewrites or empties, with their real physical primary key and,
 * where the database has a CHECK constraint, the exact allowed state values. Every other
 * catalogue table is preserved byte-for-byte.
 */
const MANAGED_TABLES: Readonly<
  Record<
    string,
    { pk: string; state?: { column: string; values: readonly string[] } }
  >
> = Object.freeze({
  "public.session": { pk: "id" },
  "public.verification": { pk: "id" },
  "public.step_up_confirmation": { pk: "id" },
  "public.customer_invitation_auth_continuation": { pk: "id" },
  "public.account": { pk: "id" },
  "public.apikey": { pk: "id" },
  "public.api_key": { pk: "apikey_id" },
  "public.user": { pk: "id" },
  "public.two_factor": { pk: "id" },
  "public.instance_plugin_config": { pk: "id" },
  "public.identity_connection": { pk: "id" },
  "public.scim_connection": { pk: "identity_connection_id" },
  "public.instance_setting": { pk: "id" },
  "public.webhook": { pk: "id" },
  "public.user_notification_preference": { pk: "id" },
  "public.import_source_connection": { pk: "id" },
  "public.customer_invitation_delivery": {
    pk: "id",
    state: {
      column: "state",
      values: ["queued", "sending", "sent", "suppressed", "failed"],
    },
  },
  "public.invitation": { pk: "id" },
  "public.automation": { pk: "id" },
  "public.instance_job_configuration": { pk: "name" },
  "public.outbox": {
    pk: "event_id",
    state: { column: "state", values: ["pending", "delivered", "dead"] },
  },
  "public.notification_delivery": {
    pk: "id",
    state: {
      column: "state",
      values: ["pending", "delivered", "dead", "suppressed"],
    },
  },
  "public.webhook_delivery": {
    pk: "id",
    state: {
      column: "state",
      values: [
        "pending",
        "delivered",
        "dead",
        "skipped_out_of_reach",
        "cancelled",
      ],
    },
  },
  "public.automation_run": {
    pk: "id",
    state: {
      column: "state",
      values: ["pending", "running", "done", "failed", "skipped", "abandoned"],
    },
  },
  "public.import_run": {
    pk: "id",
    state: {
      column: "state",
      values: ["queued", "running", "paused", "completed", "failed"],
    },
  },
});

const DELETABLE_TABLES = new Set<string>(CANDIDATE_COPY_SCRUB_DELETABLE_TABLES);

/** Encrypted columns: rotated to an inert value under the candidate key, one table-driven loop. */
const SECRET_COLUMNS: readonly {
  table: string;
  column: string;
  kind: "tdk1" | "encv2";
  nullable: boolean;
  usable:
    | "usablePluginSecrets"
    | "usableIdentityClientSecrets"
    | "usableWebhookSecrets"
    | "usableNotificationSecrets"
    | "usableImportSourceCredentials";
}[] = [
  {
    table: "public.instance_plugin_config",
    column: "secrets",
    kind: "tdk1",
    nullable: true,
    usable: "usablePluginSecrets",
  },
  {
    table: "public.identity_connection",
    column: "client_secret",
    kind: "tdk1",
    nullable: false,
    usable: "usableIdentityClientSecrets",
  },
  {
    table: "public.webhook",
    column: "secret",
    kind: "encv2",
    nullable: false,
    usable: "usableWebhookSecrets",
  },
  {
    table: "public.webhook",
    column: "secret_previous",
    kind: "encv2",
    nullable: true,
    usable: "usableWebhookSecrets",
  },
  ...(["ntfy_token", "gotify_token", "webhook_secret"] as const).map(
    (column) => ({
      table: "public.user_notification_preference",
      column,
      kind: "encv2" as const,
      nullable: true,
      usable: "usableNotificationSecrets" as const,
    }),
  ),
  {
    table: "public.import_source_connection",
    column: "credential_ciphertext",
    kind: "encv2",
    nullable: true,
    usable: "usableImportSourceCredentials",
  },
];

const INTRINSIC_PASSWORD_PLUGIN_ID = "auth.password";
const PASSWORD_PORTAL_SCOPES = ["both", "agent", "customer"] as const;

const ENCRYPTION_KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;
const CREDENTIAL_HASH_HEX_RE = /^[0-9a-f]{64}$/;
const BASE64URL_CANONICAL_RE = /^[A-Za-z0-9_-]+$/;
const BETTER_AUTH_CIPHERTEXT_HEX_RE = /^[0-9a-f]+$/;
const TDK1_HEADER = Buffer.from("TDK1", "ascii");
const TDK1_KEY_ID_BYTES = 8;
const TDK1_IV_BYTES = 12;
const TDK1_TAG_BYTES = 16;
const TDK1_MIN_BYTES =
  TDK1_HEADER.length + TDK1_KEY_ID_BYTES + TDK1_IV_BYTES + TDK1_TAG_BYTES + 1;
const ENC_V2_PREFIX = "enc:v2:";
const BETTER_AUTH_MIN_HEX_LENGTH = 82; // 12-byte IV (24 hex) + >=1 byte plaintext + 16-byte tag (32 hex) + hex expansion

export type CandidateCopyErrorCode =
  | "INVALID_INPUT"
  | "KEY_REUSE_FORBIDDEN"
  | "SCHEMA_CATALOGUE_DRIFT"
  | "MISSING_AAD"
  | "UNKNOWN_ENVELOPE_VERSION"
  | "INVALID_ENVELOPE_SHAPE"
  | "OLD_KEY_DECRYPT_FAILED"
  | "NEW_KEY_VERIFY_FAILED"
  | "OLD_KEY_STILL_DECRYPTS"
  | "RUNTIME_PROOF_REQUIRED"
  | "INVARIANT_VIOLATION";

export class CandidateCopyTransformError extends Error {
  readonly code: CandidateCopyErrorCode;
  readonly table?: string;
  readonly rowId?: string;
  readonly column?: string;

  constructor(
    code: CandidateCopyErrorCode,
    message: string,
    context?: {
      table?: string;
      rowId?: string;
      column?: string;
    },
  ) {
    super(message);
    this.name = "CandidateCopyTransformError";
    this.code = code;
    this.table = context?.table;
    this.rowId = context?.rowId;
    this.column = context?.column;
  }
}

export type CandidateCopyRow = Record<string, unknown>;

export interface CandidateCopyCatalogueTable {
  schema: string;
  table: string;
  columns: readonly string[];
}

/** Rows were loaded: count and protected fingerprint are always recomputed from them. */
export interface CandidateCopyRowBackedTable {
  columns: readonly string[];
  rows: readonly CandidateCopyRow[];
  /** Optional caller metadata; rejected when it disagrees with the supplied rows. */
  rowCount?: number;
  protectedFingerprint?: string;
}

/** Only a trusted digest was observed (preserved business tables that were not loaded). */
export interface CandidateCopyDigestOnlyTable {
  columns: readonly string[];
  observation: "digest-only";
  rowCount: number;
  protectedFingerprint: string;
}

export type CandidateCopyTableState =
  | CandidateCopyRowBackedTable
  | CandidateCopyDigestOnlyTable;

export interface CandidateCopyAttachmentSnapshot {
  objectCount: number;
  fingerprint: string;
}

/** Every one of the reviewed catalogue tables, keyed `schema.table`, and nothing else. */
export interface CandidateCopyDatabaseSnapshot {
  catalogueHash: string;
  tables: Readonly<Record<string, CandidateCopyTableState>>;
  attachments: CandidateCopyAttachmentSnapshot;
}

export interface CandidateCopyVolumesInput {
  baselinePostgresVolume: string;
  candidatePostgresVolume: string;
  baselineAttachmentsVolume: string;
  candidateAttachmentsVolume: string;
  baselineValkeyVolume?: string;
  candidateValkeyVolume?: string;
}

/**
 * Pre-boot proof, bound to the verified candidate profile (image digest, resolved environment
 * fingerprint and Compose isolation) that the candidate will run with. This transform runs
 * offline before the candidate boots, so nothing here is observed from a live process, and the
 * database copy alone cannot prove any of it.
 *
 * Several outbound paths are deliberately NOT mutated in the database because their columns are
 * outside the retained scrub allowlist: `notification_digest`, `instance_job_run`,
 * `scheduled_transition`, `sla_escalation`, `report_export` queues, the per-user
 * `ntfy_enabled` / `gotify_enabled` / `webhook_enabled` channels, and the default-enabled agent
 * magic-link / email-OTP methods when no plugin row exists. They are neutralised by the
 * candidate read-only runtime (`TASKDESK_ROLE=web` + `TASKDESK_CANDIDATE_READ_ONLY=1`) (no autonomous workers, no job handlers, no web invitation
 * poller, non-password local auth disabled) plus an internal network without external egress.
 * Hence every flag below must be true/zero, and the digests tie the claim to one profile.
 */
export interface CandidateCopyRuntimeObservation {
  source: "verified-candidate-profile";
  slot: string;
  candidateImageDigest: string;
  candidateEnvFingerprint: string;
  runtimeRole: "web";
  /** TASKDESK_CANDIDATE_READ_ONLY=1 as observed on the running candidate. */
  candidateReadOnly: boolean;
  networkExternalEgressBlocked: boolean;
  autonomousWorkersDisabled: boolean;
  nonPasswordLocalAuthDisabled: boolean;
  runnableJobHandlers: number;
  webInvitationPollerEnabled: boolean;
}

export interface CandidateCopyTransformInput {
  slot: string;
  volumes: CandidateCopyVolumesInput;
  baselineEncryptionKey: string;
  candidateEncryptionKey: string;
  baselineAuthSecret: string;
  candidateAuthSecret: string;
  baselineEncryptionKeyPrevious?: string | null;
  candidateEncryptionKeyPrevious?: string | null;
  now?: Date;
  catalogue: readonly CandidateCopyCatalogueTable[];
  runtimeObservation: CandidateCopyRuntimeObservation;
  snapshot: CandidateCopyDatabaseSnapshot;
}

export interface CandidateCopyTableMetric {
  observation: "rows" | "digest-only";
  rowCount: number;
  protectedFingerprint: string;
  modifiedColumns: string[];
}

export interface CandidateCopyIntrinsicAuthState {
  storedPasswordRows: number;
  enabledPasswordRows: number;
  agentPasswordEnabled: boolean;
  customerPasswordEnabled: boolean;
}

export interface CandidateCopyDataInspectionProof {
  slot: string;
  catalogueHash: string;
  baselinePostgresVolume: string;
  candidatePostgresVolume: string;
  baselineAttachmentsVolume: string;
  candidateAttachmentsVolume: string;
  baselineValkeyVolume?: string;
  candidateValkeyVolume?: string;
  tables: Record<string, CandidateCopyTableMetric>;
  intrinsicAuthState: CandidateCopyIntrinsicAuthState;
  attachments: CandidateCopyAttachmentSnapshot;
}
export type CandidateCopySnapshotInspection = CandidateCopyDataInspectionProof;

export interface CandidateCopyCredentialsProof {
  activeSessions: number;
  verificationRows: number;
  stepUpConfirmations: number;
  invitationContinuations: number;
  oauthTokensPresent: number;
  enabledBetterAuthApiKeys: number;
  activeWorkspaceApiKeys: number;
  enabledExternalPluginConfigs: number;
  enabledIdentityConnections: number;
  enabledScimConnections: number;
  activeScimTokens: number;
  activeSetupOrMetricsTokens: number;
}

export interface CandidateCopyOutboundProof {
  /** Database configuration rows only; says nothing about resolved runtime handlers. */
  enabledInstanceJobs: number;
  enabledAutomations: number;
  activeWebhooks: number;
  usableWebhookSecrets: number;
  usableNotificationSecrets: number;
  usableImportSourceCredentials: number;
  usablePluginSecrets: number;
  usableIdentityClientSecrets: number;
  pendingOutbox: number;
  pendingNotificationDeliveries: number;
  pendingWebhookDeliveries: number;
  pendingCustomerInvitationDeliveries: number;
  pendingCustomerInvitations: number;
  activeAutomationRuns: number;
  activeImportRuns: number;
}

export interface CandidateCopySelectorCredentialsProof {
  sessions: number;
  verifications: number;
  stepUpConfirmations: number;
  activeApiKeys: number;
  accountProviderTokens: number;
  invitationCredentials: number;
  authContinuations: number;
  scimTokens: number;
  metricsTokens: number;
  setupTokens: number;
  oldKeyEnvelopes: number;
  unreadableEnvelopes: number;
}

export interface CandidateCopySelectorOutboundProof {
  enabledIdentityConnections: number;
  enabledScimConnections: number;
  enabledExternalPlugins: number;
  activeWebhooks: number;
  enabledAutomations: number;
  /** Copied from the caller-verified runtime observation, never derived from rows. */
  runnableJobHandlers: number;
  actionableOutboxEvents: number;
  pendingNotificationDeliveries: number;
  pendingWebhookDeliveries: number;
  actionableAutomationRuns: number;
  actionableInvitationDeliveries: number;
  runnableImportRuns: number;
}

export interface CandidateCopySelectorIntrinsicAuthProof {
  allowedPluginIds: readonly ["auth.password"];
  storedPasswordRows: number;
  enabledPasswordRows: number;
  agentPasswordEnabled: true;
  customerPasswordEnabled: boolean;
}

export interface CandidateCopyMfaProof {
  mode: "reencrypted";
  storedRows: number;
  enabledUsers: number;
  candidateReadableRows: number;
  baselineReadableRows: number;
}

export interface CandidateCopyVerificationSummary {
  tdk1RecryptedRows: number;
  encV2RecryptedValues: number;
  twoFactorRecryptedRows: number;
  scrubbedTransientRows: Record<
    (typeof CANDIDATE_COPY_SCRUB_DELETABLE_TABLES)[number],
    number
  >;
  preservedTableCount: number;
}

/** The exact ordered shape `assertPreservationProof` in the candidate selector expects. */
export interface CandidateCopySelectorPreservationProof {
  schemaFingerprint: string;
  tables: {
    schema: string;
    table: string;
    columns: readonly string[];
    excludedColumns: string[];
    rowCount: number;
    protectedFingerprint: string;
  }[];
}

export interface CandidateCopyLocalAuthResolutionProof {
  agentStoredPasswordEnabled: true;
  customerStoredPasswordEnabled: boolean;
  enabledNonPasswordAuthPluginRows: 0;
  /** True when no stored row exists, so `auth.ts` defaults the method on for the agent portal. */
  agentStoredMagicLinkDefaultedWithoutRow: boolean;
  agentStoredEmailOtpDefaultedWithoutRow: boolean;
  /** Those defaults are suppressed by the verified candidate-readonly runtime role. */
  nonPasswordLocalAuthSuppressedByRuntimeRole: true;
}

export interface CandidateCopyVerificationResult {
  baselineInspection: CandidateCopyDataInspectionProof;
  candidateInspection: CandidateCopyDataInspectionProof;
  credentialsProof: CandidateCopyCredentialsProof;
  outboundProof: CandidateCopyOutboundProof;
  selectorCredentials: CandidateCopySelectorCredentialsProof;
  selectorOutbound: CandidateCopySelectorOutboundProof;
  selectorIntrinsicAuth: CandidateCopySelectorIntrinsicAuthProof;
  localAuthResolutionProof: CandidateCopyLocalAuthResolutionProof;
  /** Projection of `candidateInspection`; use `toSelectorPreservationProof` for the baseline. */
  selectorPreservation: CandidateCopySelectorPreservationProof;
  mfaProof: CandidateCopyMfaProof;
}

export interface CandidateCopyTransformResult
  extends CandidateCopyVerificationResult {
  snapshot: CandidateCopyDatabaseSnapshot;
  summary: CandidateCopyVerificationSummary;
}

/** One caller-owned database transaction. Rejecting from `work` must roll every write back. */
export interface CandidateCopyTransactionSession<TCommitReceipt = void> {
  loadSnapshot(): Promise<CandidateCopyDatabaseSnapshot>;
  applyTransformedSnapshot(
    snapshot: CandidateCopyDatabaseSnapshot,
  ): Promise<TCommitReceipt>;
  /**
   * Re-reads the persisted rows inside the same transaction, after the writes. The caller MUST
   * run fresh SELECTs on the transactional connection; returning in-memory snapshots (or any
   * object shared with `loadSnapshot` / `applyTransformedSnapshot` arguments) is rejected.
   */
  reloadSnapshot(): Promise<CandidateCopyDatabaseSnapshot>;
}

export interface CandidateCopyTransactionalBoundary<TCommitReceipt = void> {
  runInTransaction<TResult>(
    work: (
      session: CandidateCopyTransactionSession<TCommitReceipt>,
    ) => Promise<TResult>,
  ): Promise<TResult>;
}

function requireNonEmptyTrimmedString(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CandidateCopyTransformError(
      "INVALID_INPUT",
      `${fieldName} must be a non-empty string`,
    );
  }
  return value.trim();
}

function normalizeEncryptionKeyHex(keyHex: unknown, fieldName: string): string {
  if (
    typeof keyHex !== "string" ||
    !ENCRYPTION_KEY_HEX_RE.test(keyHex.trim())
  ) {
    throw new CandidateCopyTransformError(
      "INVALID_INPUT",
      `${fieldName} must be a 64-character hex string (32 bytes)`,
    );
  }
  return keyHex.trim().toLowerCase();
}

function validateAuthSecretInput(secret: unknown, fieldName: string): string {
  if (typeof secret !== "string") {
    throw new CandidateCopyTransformError(
      "INVALID_INPUT",
      `${fieldName} must be a non-placeholder secret of at least 32 characters`,
    );
  }
  const resolved = resolveAuthSecret(secret);
  if (!resolved.ok) {
    throw new CandidateCopyTransformError(
      "INVALID_INPUT",
      `${fieldName} is invalid: ${resolved.reason}`,
    );
  }
  return resolved.secret;
}

function deriveTdk1KeyIdHex(keyHex: string): string {
  const keyBytes = Buffer.from(keyHex, "hex");
  return createHash("sha256")
    .update(keyBytes)
    .digest()
    .subarray(0, TDK1_KEY_ID_BYTES)
    .toString("hex");
}

/**
 * Executes a synchronous callback with `process.env.TASKDESK_ENCRYPTION_KEY`
 * bound to a single key and `TASKDESK_ENCRYPTION_KEY_PREVIOUS` unset.
 * Candidate copy transform strictly forbids `TASKDESK_ENCRYPTION_KEY_PREVIOUS`
 * fallback during both baseline verification and candidate re-encryption.
 */
function withScopedSingleEncryptionKey<T>(
  keyHex: string,
  operation: () => T,
): T {
  const previousPrimary = process.env.TASKDESK_ENCRYPTION_KEY;
  const previousFallback = process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  process.env.TASKDESK_ENCRYPTION_KEY = keyHex;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  try {
    return operation();
  } finally {
    if (previousPrimary === undefined) {
      delete process.env.TASKDESK_ENCRYPTION_KEY;
    } else {
      process.env.TASKDESK_ENCRYPTION_KEY = previousPrimary;
    }
    if (previousFallback === undefined) {
      delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
    } else {
      process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS = previousFallback;
    }
  }
}

export function buildInertCandidateSecretPlaintext(
  domain: string,
  rowId: string,
  column: string,
  nonceHex = "",
): string {
  const digest = createHash("sha256")
    .update(
      `taskdesk:candidate-copy:inert:v1:${domain}:${rowId}:${column}:${nonceHex}`,
    )
    .digest("hex")
    .slice(0, 32);
  return `tdk-candidate-inert-v1-${domain}-${digest}`;
}

function requireRowId(rowId: unknown, table: string, column: string): string {
  if (typeof rowId !== "string" || rowId.trim().length === 0) {
    throw new CandidateCopyTransformError(
      "MISSING_AAD",
      `Missing non-empty row id required as AAD for ${table}.${column}`,
      { table, column },
    );
  }
  return rowId;
}

function toBuffer(
  value: unknown,
  table: string,
  rowId: string,
  column: string,
): Buffer {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  throw new CandidateCopyTransformError(
    "INVALID_ENVELOPE_SHAPE",
    `Expected binary bytea envelope for ${table}.${column}`,
    { table, rowId, column },
  );
}

function assertValidTdk1EnvelopeBuffer(
  value: unknown,
  table: string,
  rowId: string,
  column: string,
): Buffer {
  const buf = toBuffer(value, table, rowId, column);
  if (buf.length < TDK1_HEADER.length) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `TDK1 envelope is truncated in ${table}.${column}`,
      { table, rowId, column },
    );
  }
  const header = buf.subarray(0, TDK1_HEADER.length);
  if (!header.equals(TDK1_HEADER)) {
    throw new CandidateCopyTransformError(
      "UNKNOWN_ENVELOPE_VERSION",
      `Unsupported bytea envelope version header in ${table}.${column}`,
      { table, rowId, column },
    );
  }
  if (buf.length < TDK1_MIN_BYTES) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `TDK1 envelope is shorter than minimum header+keyId+iv+tag+ciphertext length in ${table}.${column}`,
      { table, rowId, column },
    );
  }
  return buf;
}

function decryptTdk1WithSingleKey(
  ciphertext: unknown,
  aad: string,
  keyHex: string,
  context: { table: string; rowId: string; column: string },
  errorCode: CandidateCopyErrorCode = "OLD_KEY_DECRYPT_FAILED",
): string {
  const buf = assertValidTdk1EnvelopeBuffer(
    ciphertext,
    context.table,
    context.rowId,
    context.column,
  );
  if (aad.trim().length === 0) {
    throw new CandidateCopyTransformError(
      "MISSING_AAD",
      `Missing AAD for ${context.table}.${context.column}`,
      context,
    );
  }
  const actualKeyId = envelopeKeyId(buf);
  const expectedKeyId = deriveTdk1KeyIdHex(keyHex);
  if (actualKeyId !== expectedKeyId) {
    throw new CandidateCopyTransformError(
      errorCode,
      `TDK1 keyId mismatch in ${context.table}.${context.column}`,
      context,
    );
  }
  try {
    const plaintext = withScopedSingleEncryptionKey(keyHex, () =>
      decryptIdentityClientSecret(aad, buf),
    );
    if (plaintext.length === 0) {
      throw new Error("Empty plaintext");
    }
    return plaintext;
  } catch {
    throw new CandidateCopyTransformError(
      errorCode,
      `Failed to authenticate or decrypt TDK1 secret in ${context.table}.${context.column}`,
      context,
    );
  }
}

function encryptTdk1WithSingleKey(
  plaintext: string,
  aad: string,
  keyHex: string,
  context: { table: string; rowId: string; column: string },
): Buffer {
  if (aad.trim().length === 0) {
    throw new CandidateCopyTransformError(
      "MISSING_AAD",
      `Missing AAD for ${context.table}.${context.column}`,
      context,
    );
  }
  try {
    return withScopedSingleEncryptionKey(keyHex, () =>
      encryptIdentityClientSecret(aad, plaintext),
    );
  } catch {
    throw new CandidateCopyTransformError(
      "NEW_KEY_VERIFY_FAILED",
      `Failed to encrypt TDK1 secret in ${context.table}.${context.column}`,
      context,
    );
  }
}

function assertOldKeyCannotDecryptTdk1(
  ciphertext: Buffer,
  aad: string,
  baselineKeyHex: string,
  context: { table: string; rowId: string; column: string },
): void {
  let decryptedWithOldKey = false;
  try {
    withScopedSingleEncryptionKey(baselineKeyHex, () =>
      decryptIdentityClientSecret(aad, ciphertext),
    );
    decryptedWithOldKey = true;
  } catch {
    decryptedWithOldKey = false;
  }
  if (decryptedWithOldKey) {
    throw new CandidateCopyTransformError(
      "OLD_KEY_STILL_DECRYPTS",
      `Candidate TDK1 secret in ${context.table}.${context.column} is still decryptable by baseline key`,
      context,
    );
  }
}

function decodeCanonicalBase64UrlSegment(
  segment: string,
  context: { table: string; rowId: string; column: string },
): Buffer {
  if (segment.length === 0 || !BASE64URL_CANONICAL_RE.test(segment)) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `Malformed base64url segment in ${context.table}.${context.column}`,
      context,
    );
  }
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== segment) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `Non-canonical base64url encoding in ${context.table}.${context.column}`,
      context,
    );
  }
  return decoded;
}

function assertValidEncV2EnvelopeForKey(
  value: unknown,
  expectedKeyHex: string,
  context: { table: string; rowId: string; column: string },
  errorCode: CandidateCopyErrorCode = "OLD_KEY_DECRYPT_FAILED",
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `Expected non-empty enc:v2 envelope string in ${context.table}.${context.column}`,
      context,
    );
  }
  if (!value.startsWith(ENC_V2_PREFIX)) {
    throw new CandidateCopyTransformError(
      "UNKNOWN_ENVELOPE_VERSION",
      `Unsupported text secret envelope version in ${context.table}.${context.column}; expected enc:v2:`,
      context,
    );
  }
  const payloadB64 = value.slice(ENC_V2_PREFIX.length);
  const envelopeBuf = decodeCanonicalBase64UrlSegment(payloadB64, context);
  assertValidTdk1EnvelopeBuffer(
    envelopeBuf,
    context.table,
    context.rowId,
    context.column,
  );
  const actualKeyId = envelopeKeyId(envelopeBuf);
  const expectedKeyId = deriveTdk1KeyIdHex(expectedKeyHex);
  if (actualKeyId !== expectedKeyId) {
    throw new CandidateCopyTransformError(
      errorCode,
      `enc:v2 keyId mismatch for ${context.table}.${context.column}`,
      context,
    );
  }
  return value;
}

function decryptEncV2WithSingleKey(
  value: unknown,
  keyHex: string,
  context: { table: string; rowId: string; column: string },
  errorCode: CandidateCopyErrorCode = "OLD_KEY_DECRYPT_FAILED",
): string {
  const envelope = assertValidEncV2EnvelopeForKey(
    value,
    keyHex,
    context,
    errorCode,
  );
  try {
    const plaintext = withScopedSingleEncryptionKey(keyHex, () =>
      decryptSecret(envelope),
    );
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      throw new Error("Empty decrypted secret");
    }
    return plaintext;
  } catch {
    throw new CandidateCopyTransformError(
      errorCode,
      `Failed to authenticate or decrypt enc:v2 secret in ${context.table}.${context.column}`,
      context,
    );
  }
}

function encryptEncV2WithSingleKey(
  plaintext: string,
  keyHex: string,
  context: { table: string; rowId: string; column: string },
): string {
  try {
    const encrypted = withScopedSingleEncryptionKey(keyHex, () =>
      encryptSecret(plaintext),
    );
    if (typeof encrypted !== "string" || !encrypted.startsWith(ENC_V2_PREFIX)) {
      throw new Error("Unexpected encryptSecret output");
    }
    return encrypted;
  } catch {
    throw new CandidateCopyTransformError(
      "NEW_KEY_VERIFY_FAILED",
      `Failed to encrypt enc:v2 secret in ${context.table}.${context.column}`,
      context,
    );
  }
}

function assertOldKeyCannotDecryptEncV2(
  ciphertext: string,
  baselineKeyHex: string,
  context: { table: string; rowId: string; column: string },
): void {
  let decryptedWithOldKey = false;
  try {
    withScopedSingleEncryptionKey(baselineKeyHex, () =>
      decryptSecret(ciphertext),
    );
    decryptedWithOldKey = true;
  } catch {
    decryptedWithOldKey = false;
  }
  if (decryptedWithOldKey) {
    throw new CandidateCopyTransformError(
      "OLD_KEY_STILL_DECRYPTS",
      `Candidate enc:v2 secret in ${context.table}.${context.column} is still decryptable by baseline key`,
      context,
    );
  }
}

function assertValidBetterAuthCiphertextShape(
  value: unknown,
  context: { table: string; rowId: string; column: string },
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `Expected non-empty Better Auth ciphertext in ${context.table}.${context.column}`,
      context,
    );
  }
  if (value.startsWith("$ba$")) {
    throw new CandidateCopyTransformError(
      "UNKNOWN_ENVELOPE_VERSION",
      `Unsupported Better Auth envelope prefix in ${context.table}.${context.column}`,
      context,
    );
  }
  if (
    value.length < BETTER_AUTH_MIN_HEX_LENGTH ||
    value.length % 2 !== 0 ||
    !BETTER_AUTH_CIPHERTEXT_HEX_RE.test(value)
  ) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `Malformed Better Auth hex ciphertext in ${context.table}.${context.column}`,
      context,
    );
  }
  return value;
}

async function decryptBetterAuthCiphertext(
  ciphertext: unknown,
  authSecret: string,
  context: { table: string; rowId: string; column: string },
  errorCode: CandidateCopyErrorCode = "OLD_KEY_DECRYPT_FAILED",
): Promise<string> {
  const validated = assertValidBetterAuthCiphertextShape(ciphertext, context);
  try {
    const plaintext = await symmetricDecrypt({
      key: authSecret,
      data: validated,
    });
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      throw new Error("Empty Better Auth plaintext");
    }
    return plaintext;
  } catch {
    throw new CandidateCopyTransformError(
      errorCode,
      `Failed to decrypt Better Auth secret in ${context.table}.${context.column}`,
      context,
    );
  }
}

async function encryptBetterAuthPlaintext(
  plaintext: string,
  authSecret: string,
  context: { table: string; rowId: string; column: string },
): Promise<string> {
  try {
    const encrypted = await symmetricEncrypt({
      key: authSecret,
      data: plaintext,
    });
    return assertValidBetterAuthCiphertextShape(encrypted, context);
  } catch (err) {
    if (err instanceof CandidateCopyTransformError) {
      throw err;
    }
    throw new CandidateCopyTransformError(
      "NEW_KEY_VERIFY_FAILED",
      `Failed to encrypt Better Auth secret in ${context.table}.${context.column}`,
      context,
    );
  }
}

async function assertOldAuthSecretCannotDecrypt(
  ciphertext: string,
  baselineAuthSecret: string,
  context: { table: string; rowId: string; column: string },
): Promise<void> {
  let decryptedWithOldSecret = false;
  try {
    await symmetricDecrypt({
      key: baselineAuthSecret,
      data: ciphertext,
    });
    decryptedWithOldSecret = true;
  } catch {
    decryptedWithOldSecret = false;
  }
  if (decryptedWithOldSecret) {
    throw new CandidateCopyTransformError(
      "OLD_KEY_STILL_DECRYPTS",
      `Candidate Better Auth ciphertext in ${context.table}.${context.column} is still decryptable by baseline auth secret`,
      context,
    );
  }
}

function parseValidatedBackupCodes(
  plaintext: string,
  context: { table: string; rowId: string; column: string },
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `Decrypted two_factor.backup_codes is not valid JSON in ${context.table}.${context.column}`,
      context,
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) => typeof entry !== "string" || entry.trim().length === 0,
    )
  ) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      `Decrypted two_factor.backup_codes must be a string[] in ${context.table}.${context.column}`,
      context,
    );
  }
  return parsed as string[];
}

function verifyCustomerInvitationDeliveryOuterEnvelope(
  row: CandidateCopyRow,
  baselineEncryptionKey: string,
): void {
  const rowId = requireRowId(
    row.id,
    "public.customer_invitation_delivery",
    "envelope",
  );
  const context = {
    table: "public.customer_invitation_delivery",
    rowId,
    column: "envelope",
  };
  if (
    typeof row.invitation_id !== "string" ||
    row.invitation_id.trim().length === 0
  ) {
    throw new CandidateCopyTransformError(
      "MISSING_AAD",
      "Missing invitation_id required for customer_invitation_delivery.envelope AAD",
      context,
    );
  }
  const credentialHash = row.credential_hash;
  if (
    typeof credentialHash !== "string" ||
    !CREDENTIAL_HASH_HEX_RE.test(credentialHash)
  ) {
    throw new CandidateCopyTransformError(
      "MISSING_AAD",
      "customer_invitation_delivery.credential_hash must be a 64-character lowercase hex SHA-256 digest when envelope is present",
      {
        table: "public.customer_invitation_delivery",
        rowId,
        column: "credential_hash",
      },
    );
  }
  const envelope = row.envelope;
  if (typeof envelope !== "string" || envelope.length === 0) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      "customer_invitation_delivery.envelope must be a non-empty base64url string",
      context,
    );
  }
  const outerBuf = decodeCanonicalBase64UrlSegment(envelope, context);
  assertValidTdk1EnvelopeBuffer(outerBuf, context.table, rowId, context.column);
  const outerAad = `taskdesk:customer-invitation-delivery:v2:${rowId}:${row.invitation_id}:${credentialHash}`;
  const outerPlaintext = decryptTdk1WithSingleKey(
    outerBuf,
    outerAad,
    baselineEncryptionKey,
    context,
    "OLD_KEY_DECRYPT_FAILED",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(outerPlaintext);
  } catch {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      "customer_invitation_delivery.envelope plaintext is not valid JSON",
      context,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      "customer_invitation_delivery.envelope payload must be an object",
      context,
    );
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 2) {
    throw new CandidateCopyTransformError(
      "UNKNOWN_ENVELOPE_VERSION",
      "Unsupported customer_invitation_delivery.envelope payload version; expected version=2",
      context,
    );
  }
  try {
    withScopedSingleEncryptionKey(baselineEncryptionKey, () =>
      reencryptDeliveryEnvelope({
        deliveryId: rowId,
        invitationId: row.invitation_id as string,
        credentialHash,
        envelope,
      }),
    );
  } catch {
    throw new CandidateCopyTransformError(
      "INVALID_ENVELOPE_SHAPE",
      "customer_invitation_delivery.envelope failed v2 inner structure and binding validation",
      context,
    );
  }
}

/** Code-unit comparison: identical in every locale and ICU build. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Canonical form with disjoint tuple tags, so no JSON value a user can store can collide with
 * a Date, byte string, bigint or object encoding.
 */
function normalizeCanonicalCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return ["bytes", Buffer.from(value).toString("hex")];
  }
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (Array.isArray(value)) {
    return ["arr", value.map((item) => normalizeCanonicalCellValue(item))];
  }
  if (typeof value === "object") {
    return [
      "obj",
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, entry]) => [key, normalizeCanonicalCellValue(entry)]),
    ];
  }
  return ["val", value];
}

function cloneCellValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value) as unknown as T;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneCellValue(entry)) as unknown as T;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = cloneCellValue(entryValue);
    }
    return out as T;
  }
  return value;
}

function cloneRow<T extends Record<string, unknown>>(row: T): T {
  return cloneCellValue(row);
}

export function computeProtectedTableFingerprint(
  tableName: string,
  rows: readonly Record<string, unknown>[],
  excludedColumns: readonly string[] = [],
): string {
  const excluded = new Set(excludedColumns);
  const serializedRows = rows.map((row) => {
    const keys = Object.keys(row)
      .filter((key) => !excluded.has(key))
      .sort(compareCodeUnits);
    const projected: Record<string, unknown> = {};
    for (const key of keys) {
      projected[key] = normalizeCanonicalCellValue(row[key]);
    }
    return JSON.stringify(projected);
  });
  serializedRows.sort(compareCodeUnits);
  const hash = createHash("sha256");
  hash.update(`table:${tableName}:count:${rows.length}\n`);
  for (const serializedRow of serializedRows) {
    hash.update(serializedRow);
    hash.update("\n");
  }
  return hash.digest("hex");
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function fail(
  code: CandidateCopyErrorCode,
  message: string,
  context?: { table?: string; rowId?: string; column?: string },
): never {
  throw new CandidateCopyTransformError(code, message, context);
}

function tableKey(entry: CandidateCopyCatalogueTable): string {
  return `${entry.schema}.${entry.table}`;
}

function shortTableName(table: string): string {
  return table.replace(/^public\./, "");
}

export function computeCandidateCopyCatalogueHash(
  catalogue: readonly CandidateCopyCatalogueTable[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        catalogue.map(({ schema, table, columns }) => ({
          schema,
          table,
          columns,
        })),
      ),
    )
    .digest("hex");
}

/** The supplied catalogue must hash to the reviewed physical schema (184 tables, 1974 columns). */
function assertReviewedCatalogue(
  catalogue: unknown,
): readonly CandidateCopyCatalogueTable[] {
  if (
    !Array.isArray(catalogue) ||
    catalogue.some(
      (entry) =>
        typeof entry !== "object" ||
        entry === null ||
        !Array.isArray((entry as { columns?: unknown }).columns),
    )
  ) {
    fail("INVALID_INPUT", "A reviewed schema catalogue is required");
  }
  const entries = catalogue as readonly CandidateCopyCatalogueTable[];
  const hash = computeCandidateCopyCatalogueHash(entries);
  if (hash !== CANDIDATE_COPY_REVIEWED_CATALOGUE_HASH) {
    fail("SCHEMA_CATALOGUE_DRIFT", `Unreviewed schema catalogue hash: ${hash}`);
  }
  return entries;
}

function assertSameColumns(
  table: string,
  actual: unknown,
  expected: readonly string[],
): void {
  const expectedSet = new Set(expected);
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((column) => !expectedSet.has(column)) ||
    new Set(actual).size !== expected.length
  ) {
    fail(
      "SCHEMA_CATALOGUE_DRIFT",
      `Columns of ${table} differ from the reviewed physical schema`,
      { table },
    );
  }
}

function assertSameRowKeys(
  table: string,
  row: CandidateCopyRow,
  columns: ReadonlySet<string>,
): void {
  const keys = Object.keys(row);
  if (keys.length !== columns.size || keys.some((key) => !columns.has(key))) {
    fail(
      "SCHEMA_CATALOGUE_DRIFT",
      `A row of ${table} has missing or unknown columns`,
      { table },
    );
  }
}

function requireManagedRows(
  snapshot: CandidateCopyDatabaseSnapshot,
  table: string,
): readonly CandidateCopyRow[] {
  const state = snapshot.tables[table];
  if (!state || !("rows" in state) || !Array.isArray(state.rows)) {
    fail("INVALID_INPUT", `Rows are required for managed table ${table}`, {
      table,
    });
  }
  return state.rows;
}

function isIntrinsicPasswordRow(row: CandidateCopyRow): boolean {
  return (
    row.plugin_id === INTRINSIC_PASSWORD_PLUGIN_ID &&
    row.scope === "instance" &&
    row.workspace_id === null &&
    (PASSWORD_PORTAL_SCOPES as readonly unknown[]).includes(row.portal_scope) &&
    typeof row.enabled === "boolean"
  );
}

/** Mirrors `resolveStoredLocalAuthProviders` in `apps/api/src/auth.ts` for the password method. */
export function computeIntrinsicAuthState(
  pluginRows: readonly CandidateCopyRow[],
): CandidateCopyIntrinsicAuthState {
  const resolve = (portal: "agent" | "customer"): boolean => {
    const configured = pluginRows.filter(
      (row) =>
        row.plugin_id === INTRINSIC_PASSWORD_PLUGIN_ID &&
        row.scope === "instance" &&
        (row.portal_scope === "both" || row.portal_scope === portal),
    );
    return configured.length === 0
      ? portal === "agent"
      : configured.some((row) => row.enabled === true);
  };
  const intrinsic = pluginRows.filter(isIntrinsicPasswordRow);
  return {
    storedPasswordRows: intrinsic.length,
    enabledPasswordRows: intrinsic.filter((row) => row.enabled === true).length,
    agentPasswordEnabled: resolve("agent"),
    customerPasswordEnabled: resolve("customer"),
  };
}

function modifiedColumnsByPrimaryKey(
  table: string,
  pk: string,
  allowed: readonly string[],
  baselineRows: readonly CandidateCopyRow[],
  candidateRows: readonly CandidateCopyRow[],
): string[] {
  if (baselineRows.length !== candidateRows.length) {
    fail(
      "INVARIANT_VIOLATION",
      `Row count changed unexpectedly for ${table}: baseline=${baselineRows.length}, candidate=${candidateRows.length}`,
      { table },
    );
  }
  const baselineByKey = new Map(
    baselineRows.map((row) => [String(row[pk]), row] as const),
  );
  const allowedSet = new Set(allowed);
  const modified = new Set<string>();
  for (const candidate of candidateRows) {
    const baseline = baselineByKey.get(String(candidate[pk]));
    if (!baseline) {
      fail(
        "INVARIANT_VIOLATION",
        `Candidate ${table} has a row whose ${pk} is absent from the baseline`,
        { table },
      );
    }
    for (const column of Object.keys(candidate)) {
      if (
        JSON.stringify(normalizeCanonicalCellValue(baseline[column])) ===
        JSON.stringify(normalizeCanonicalCellValue(candidate[column]))
      ) {
        continue;
      }
      if (!allowedSet.has(column)) {
        fail(
          "INVARIANT_VIOLATION",
          `Disallowed column modification detected in ${table}.${column}`,
          { table, column },
        );
      }
      modified.add(column);
    }
  }
  return [...modified].sort(compareCodeUnits);
}

function inspectTableState(
  table: string,
  state: CandidateCopyTableState | undefined,
  expectedColumns: readonly string[],
): { metric: CandidateCopyTableMetric; rows?: readonly CandidateCopyRow[] } {
  if (typeof state !== "object" || state === null) {
    fail(
      "SCHEMA_CATALOGUE_DRIFT",
      `Reviewed table ${table} is missing from the snapshot`,
      { table },
    );
  }
  assertSameColumns(table, state.columns, expectedColumns);
  const managed = MANAGED_TABLES[table];
  const rows = "rows" in state ? state.rows : undefined;

  if (rows === undefined) {
    const digest = state as CandidateCopyDigestOnlyTable;
    if (
      managed ||
      digest.observation !== "digest-only" ||
      !Number.isInteger(digest.rowCount) ||
      digest.rowCount < 0 ||
      !SHA256_HEX_RE.test(String(digest.protectedFingerprint))
    ) {
      fail(
        "INVALID_INPUT",
        `Table ${table} needs rows, or a digest-only observation with a row count and 64-hex fingerprint`,
        { table },
      );
    }
    return {
      metric: {
        observation: "digest-only",
        rowCount: digest.rowCount,
        protectedFingerprint: digest.protectedFingerprint,
        modifiedColumns: [],
      },
    };
  }

  if (!Array.isArray(rows) || "observation" in state) {
    fail("INVALID_INPUT", `Table ${table} mixes rows with digest metadata`, {
      table,
    });
  }
  const columnSet = new Set(expectedColumns);
  const seen = new Set<string>();
  for (const row of rows) {
    assertSameRowKeys(table, row, columnSet);
    if (!managed) continue;
    const key = row[managed.pk];
    if (key === null || key === undefined || seen.has(String(key))) {
      fail(
        "INVALID_INPUT",
        `Missing or duplicate primary key ${managed.pk} in ${table}`,
        { table, column: managed.pk },
      );
    }
    seen.add(String(key));
    if (
      managed.state &&
      !managed.state.values.includes(row[managed.state.column] as string)
    ) {
      fail(
        "INVALID_INPUT",
        `${table}.${managed.state.column} holds a value outside the database constraint`,
        { table, rowId: String(key), column: managed.state.column },
      );
    }
  }
  const excluded = managed ? (ALLOWLIST[table] ?? []) : [];
  const protectedFingerprint = DELETABLE_TABLES.has(table)
    ? computeProtectedTableFingerprint(table, [], [])
    : computeProtectedTableFingerprint(table, rows, excluded);
  const declared = state as CandidateCopyRowBackedTable;
  if (
    (declared.rowCount !== undefined && declared.rowCount !== rows.length) ||
    (declared.protectedFingerprint !== undefined &&
      declared.protectedFingerprint !==
        computeProtectedTableFingerprint(table, rows, excluded))
  ) {
    fail(
      "INVALID_INPUT",
      `Supplied row count or fingerprint for ${table} disagrees with its rows`,
      { table },
    );
  }
  return {
    metric: {
      observation: "rows",
      rowCount: rows.length,
      protectedFingerprint,
      modifiedColumns: [],
    },
    rows,
  };
}

export function inspectCandidateCopySnapshot(options: {
  slot: string;
  volumes: CandidateCopyVolumesInput;
  snapshot: CandidateCopyDatabaseSnapshot;
  catalogue: readonly CandidateCopyCatalogueTable[];
  baselineSnapshotForDiff?: CandidateCopyDatabaseSnapshot;
}): CandidateCopyDataInspectionProof {
  const slot = requireNonEmptyTrimmedString(options.slot, "slot");
  const volumes = options.volumes;
  const volumeNames = (
    [
      "baselinePostgresVolume",
      "candidatePostgresVolume",
      "baselineAttachmentsVolume",
      "candidateAttachmentsVolume",
    ] as const
  ).map((name) =>
    requireNonEmptyTrimmedString(volumes?.[name], `volumes.${name}`),
  );
  const catalogue = assertReviewedCatalogue(options.catalogue);
  const snapshot = options.snapshot;
  if (snapshot?.catalogueHash !== CANDIDATE_COPY_REVIEWED_CATALOGUE_HASH) {
    fail(
      "SCHEMA_CATALOGUE_DRIFT",
      `A snapshot with the reviewed catalogue hash is required (got ${String(snapshot?.catalogueHash)})`,
    );
  }
  const reviewed = new Set(catalogue.map(tableKey));
  const unknown = Object.keys(snapshot.tables ?? {}).filter(
    (name) => !reviewed.has(name),
  );
  if (unknown.length > 0) {
    fail(
      "SCHEMA_CATALOGUE_DRIFT",
      `Snapshot contains tables outside the reviewed catalogue: ${unknown.join(", ")}`,
      { table: unknown[0] },
    );
  }

  const tables: Record<string, CandidateCopyTableMetric> = {};
  for (const entry of catalogue) {
    const name = tableKey(entry);
    const { metric } = inspectTableState(
      name,
      snapshot.tables[name],
      entry.columns,
    );
    const managed = MANAGED_TABLES[name];
    if (managed && options.baselineSnapshotForDiff) {
      metric.modifiedColumns = DELETABLE_TABLES.has(name)
        ? []
        : modifiedColumnsByPrimaryKey(
            name,
            managed.pk,
            ALLOWLIST[name] ?? [],
            requireManagedRows(options.baselineSnapshotForDiff, name),
            requireManagedRows(snapshot, name),
          );
    }
    tables[name] = metric;
  }

  const intrinsicAuthState = computeIntrinsicAuthState(
    requireManagedRows(snapshot, "public.instance_plugin_config"),
  );
  if (!intrinsicAuthState.agentPasswordEnabled) {
    fail(
      "INVARIANT_VIOLATION",
      "auth.password must remain enabled for the agent portal",
      { table: "public.instance_plugin_config" },
    );
  }

  const attachments = snapshot.attachments;
  if (
    !attachments ||
    !Number.isInteger(attachments.objectCount) ||
    attachments.objectCount < 0 ||
    typeof attachments.fingerprint !== "string" ||
    attachments.fingerprint.trim().length === 0
  ) {
    fail(
      "INVALID_INPUT",
      "attachments.objectCount and attachments.fingerprint are required",
    );
  }

  const [
    baselinePostgresVolume,
    candidatePostgresVolume,
    baselineAttachmentsVolume,
    candidateAttachmentsVolume,
  ] = volumeNames as [string, string, string, string];
  return {
    slot,
    catalogueHash: snapshot.catalogueHash,
    baselinePostgresVolume,
    candidatePostgresVolume,
    baselineAttachmentsVolume,
    candidateAttachmentsVolume,
    ...(volumes.baselineValkeyVolume
      ? { baselineValkeyVolume: volumes.baselineValkeyVolume }
      : {}),
    ...(volumes.candidateValkeyVolume
      ? { candidateValkeyVolume: volumes.candidateValkeyVolume }
      : {}),
    tables,
    intrinsicAuthState,
    attachments: {
      objectCount: attachments.objectCount,
      fingerprint: attachments.fingerprint,
    },
  };
}

/** Catalogue order; excludedColumns are the scrub-allowlisted columns left out of the fingerprint. */
export function toSelectorPreservationProof(
  catalogue: readonly CandidateCopyCatalogueTable[],
  inspection: CandidateCopyDataInspectionProof,
): CandidateCopySelectorPreservationProof {
  const reviewed = assertReviewedCatalogue(catalogue);
  return {
    schemaFingerprint: inspection.catalogueHash,
    tables: reviewed.map((entry) => {
      const name = tableKey(entry);
      const metric = inspection.tables[name];
      if (!metric) {
        fail(
          "SCHEMA_CATALOGUE_DRIFT",
          `Inspection is missing reviewed table ${name}`,
          { table: name },
        );
      }
      const excluded = new Set(
        MANAGED_TABLES[name] && !DELETABLE_TABLES.has(name)
          ? (ALLOWLIST[name] ?? [])
          : [],
      );
      return {
        schema: entry.schema,
        table: entry.table,
        columns: entry.columns,
        excludedColumns: entry.columns.filter((column) => excluded.has(column)),
        rowCount: metric.rowCount,
        protectedFingerprint: metric.protectedFingerprint,
      };
    }),
  };
}

function assertRuntimeObservation(
  observation: CandidateCopyRuntimeObservation | undefined,
  slot: string,
): CandidateCopyRuntimeObservation {
  if (
    observation?.source !== "verified-candidate-profile" ||
    observation.slot !== slot ||
    !/^sha256:[0-9a-f]{64}$/.test(String(observation.candidateImageDigest)) ||
    !SHA256_HEX_RE.test(String(observation.candidateEnvFingerprint)) ||
    observation.runtimeRole !== "web" ||
    typeof observation.candidateReadOnly !== "boolean" ||
    typeof observation.networkExternalEgressBlocked !== "boolean" ||
    typeof observation.autonomousWorkersDisabled !== "boolean" ||
    typeof observation.nonPasswordLocalAuthDisabled !== "boolean" ||
    !Number.isInteger(observation.runnableJobHandlers) ||
    observation.runnableJobHandlers < 0 ||
    typeof observation.webInvitationPollerEnabled !== "boolean"
  ) {
    fail(
      "RUNTIME_PROOF_REQUIRED",
      "A verified candidate-profile observation (image digest, env fingerprint, web role with candidate read-only mode) for this slot is required; runtime state cannot be inferred from database rows",
    );
  }
  const violations = [
    observation.candidateReadOnly !== true && "candidate read-only mode off",
    observation.networkExternalEgressBlocked !== true && "external egress open",
    observation.autonomousWorkersDisabled !== true && "autonomous workers on",
    observation.nonPasswordLocalAuthDisabled !== true &&
      "non-password local auth on",
    observation.runnableJobHandlers !== 0 &&
      `jobHandlers=${observation.runnableJobHandlers}`,
    observation.webInvitationPollerEnabled && "web invitation poller on",
  ].filter(Boolean);
  if (violations.length > 0) {
    fail(
      "INVARIANT_VIOLATION",
      `Candidate runtime profile is not isolated: ${violations.join(", ")}`,
    );
  }
  return observation;
}

function normalizeKeyMaterial(input: {
  baselineEncryptionKey: string;
  candidateEncryptionKey: string;
  baselineAuthSecret: string;
  candidateAuthSecret: string;
}) {
  const baselineEncryptionKey = normalizeEncryptionKeyHex(
    input.baselineEncryptionKey,
    "baselineEncryptionKey",
  );
  const candidateEncryptionKey = normalizeEncryptionKeyHex(
    input.candidateEncryptionKey,
    "candidateEncryptionKey",
  );
  if (baselineEncryptionKey === candidateEncryptionKey) {
    fail(
      "KEY_REUSE_FORBIDDEN",
      "candidateEncryptionKey must differ from baselineEncryptionKey",
    );
  }
  const baselineAuthSecret = validateAuthSecretInput(
    input.baselineAuthSecret,
    "baselineAuthSecret",
  );
  const candidateAuthSecret = validateAuthSecretInput(
    input.candidateAuthSecret,
    "candidateAuthSecret",
  );
  if (baselineAuthSecret === candidateAuthSecret) {
    fail(
      "KEY_REUSE_FORBIDDEN",
      "candidateAuthSecret must differ from baselineAuthSecret",
    );
  }
  return {
    baselineEncryptionKey,
    candidateEncryptionKey,
    baselineAuthSecret,
    candidateAuthSecret,
  };
}

function validateTransformInputs(input: CandidateCopyTransformInput) {
  const slot = requireNonEmptyTrimmedString(input.slot, "slot");
  for (const [field, value] of [
    ["baselineEncryptionKeyPrevious", input.baselineEncryptionKeyPrevious],
    ["candidateEncryptionKeyPrevious", input.candidateEncryptionKeyPrevious],
  ] as const) {
    if (value !== undefined && value !== null && value !== "") {
      fail(
        "INVALID_INPUT",
        `TASKDESK_ENCRYPTION_KEY_PREVIOUS is forbidden in candidate copy transform input (${field} must not be set)`,
      );
    }
  }
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    fail("INVALID_INPUT", "now must be a valid Date instance");
  }
  const volumes = input.volumes;
  for (const [role, baseline, candidate] of [
    [
      "Postgres",
      volumes?.baselinePostgresVolume,
      volumes?.candidatePostgresVolume,
    ],
    [
      "Attachments",
      volumes?.baselineAttachmentsVolume,
      volumes?.candidateAttachmentsVolume,
    ],
  ] as const) {
    const left = requireNonEmptyTrimmedString(
      baseline,
      `baseline${role}Volume`,
    );
    const right = requireNonEmptyTrimmedString(
      candidate,
      `candidate${role}Volume`,
    );
    if (left === right) {
      fail(
        "INVALID_INPUT",
        `candidate${role}Volume must be isolated from baseline${role}Volume`,
      );
    }
  }
  if (
    volumes.baselineValkeyVolume &&
    volumes.baselineValkeyVolume === volumes.candidateValkeyVolume
  ) {
    fail(
      "INVALID_INPUT",
      "candidateValkeyVolume must be isolated from baselineValkeyVolume",
    );
  }
  return {
    slot,
    now,
    ...normalizeKeyMaterial(input),
    runtimeObservation: assertRuntimeObservation(
      input.runtimeObservation,
      slot,
    ),
  };
}

interface KeyMaterial {
  baselineEncryptionKey: string;
  candidateEncryptionKey: string;
  /** Per-transform random nonce; never returned. Absent when verifying a persisted snapshot. */
  inertNonceHex?: string;
}

function rotateSecretToInert(
  spec: (typeof SECRET_COLUMNS)[number],
  rowId: string,
  value: unknown,
  keys: KeyMaterial,
): Buffer | string {
  const context = { table: spec.table, rowId, column: spec.column };
  const inert = buildInertCandidateSecretPlaintext(
    shortTableName(spec.table),
    rowId,
    spec.column,
    keys.inertNonceHex,
  );
  if (spec.kind === "tdk1") {
    decryptTdk1WithSingleKey(
      value,
      rowId,
      keys.baselineEncryptionKey,
      context,
      "OLD_KEY_DECRYPT_FAILED",
    );
    const sealed = encryptTdk1WithSingleKey(
      inert,
      rowId,
      keys.candidateEncryptionKey,
      context,
    );
    const verified = decryptTdk1WithSingleKey(
      sealed,
      rowId,
      keys.candidateEncryptionKey,
      context,
      "NEW_KEY_VERIFY_FAILED",
    );
    if (verified !== inert) {
      fail(
        "NEW_KEY_VERIFY_FAILED",
        `Failed to verify re-encrypted ${spec.table}.${spec.column} under candidateEncryptionKey`,
        context,
      );
    }
    assertOldKeyCannotDecryptTdk1(
      sealed,
      rowId,
      keys.baselineEncryptionKey,
      context,
    );
    return sealed;
  }
  decryptEncV2WithSingleKey(
    value,
    keys.baselineEncryptionKey,
    context,
    "OLD_KEY_DECRYPT_FAILED",
  );
  const sealed = encryptEncV2WithSingleKey(
    inert,
    keys.candidateEncryptionKey,
    context,
  );
  const verified = decryptEncV2WithSingleKey(
    sealed,
    keys.candidateEncryptionKey,
    context,
    "NEW_KEY_VERIFY_FAILED",
  );
  if (verified !== inert) {
    fail(
      "NEW_KEY_VERIFY_FAILED",
      `Failed to verify re-encrypted ${spec.table}.${spec.column} under candidateEncryptionKey`,
      context,
    );
  }
  assertOldKeyCannotDecryptEncV2(sealed, keys.baselineEncryptionKey, context);
  return sealed;
}

/** True when the stored value is NOT the deterministic inert credential (i.e. still usable). */
function isSecretUsable(
  spec: (typeof SECRET_COLUMNS)[number],
  rowId: string,
  value: unknown,
  keys: KeyMaterial,
): boolean {
  const context = { table: spec.table, rowId, column: spec.column };
  let plaintext: string;
  if (spec.kind === "tdk1") {
    const buffer = assertValidTdk1EnvelopeBuffer(
      value,
      spec.table,
      rowId,
      spec.column,
    );
    plaintext = decryptTdk1WithSingleKey(
      buffer,
      rowId,
      keys.candidateEncryptionKey,
      context,
      "NEW_KEY_VERIFY_FAILED",
    );
    assertOldKeyCannotDecryptTdk1(
      buffer,
      rowId,
      keys.baselineEncryptionKey,
      context,
    );
  } else {
    plaintext = decryptEncV2WithSingleKey(
      value,
      keys.candidateEncryptionKey,
      context,
      "NEW_KEY_VERIFY_FAILED",
    );
    assertOldKeyCannotDecryptEncV2(
      value as string,
      keys.baselineEncryptionKey,
      context,
    );
  }
  // The nonce is not known when verifying persisted rows, so recognise the inert shape.
  return !new RegExp(
    `^tdk-candidate-inert-v1-${shortTableName(spec.table)}-[0-9a-f]{32}$`,
  ).test(plaintext);
}

async function rotateTwoFactorRow(
  row: CandidateCopyRow,
  baselineAuthSecret: string,
  candidateAuthSecret: string,
): Promise<void> {
  const table = "public.two_factor";
  const rowId = requireRowId(row.id, table, "id");
  requireRowId(row.user_id, table, "user_id");
  for (const column of ["secret", "backup_codes"] as const) {
    const context = { table, rowId, column };
    const plaintext = await decryptBetterAuthCiphertext(
      row[column],
      baselineAuthSecret,
      context,
      "OLD_KEY_DECRYPT_FAILED",
    );
    if (column === "backup_codes")
      parseValidatedBackupCodes(plaintext, context);
    const sealed = await encryptBetterAuthPlaintext(
      plaintext,
      candidateAuthSecret,
      context,
    );
    const roundTrip = await decryptBetterAuthCiphertext(
      sealed,
      candidateAuthSecret,
      context,
      "NEW_KEY_VERIFY_FAILED",
    );
    if (roundTrip !== plaintext) {
      fail(
        "NEW_KEY_VERIFY_FAILED",
        "two_factor re-encrypted secret or backup_codes did not round-trip identically under candidateAuthSecret",
        context,
      );
    }
    await assertOldAuthSecretCannotDecrypt(sealed, baselineAuthSecret, context);
    row[column] = sealed;
  }
}

function cloneTableState(
  state: CandidateCopyTableState,
  managed: boolean,
): CandidateCopyTableState {
  if (!("rows" in state) || state.rows === undefined) {
    return { ...(state as CandidateCopyDigestOnlyTable) };
  }
  return {
    columns: [...state.columns],
    rows: state.rows.map((row) => cloneRow(row)),
    ...(managed || state.rowCount === undefined
      ? {}
      : { rowCount: state.rowCount }),
    ...(managed || state.protectedFingerprint === undefined
      ? {}
      : { protectedFingerprint: state.protectedFingerprint }),
  };
}

/**
 * Pure, deterministic, fail-closed transformation of a copied baseline snapshot into a
 * candidate-safe snapshot. Never mutates the caller's snapshot and touches no database.
 */
export async function transformCandidateCopySnapshot(
  input: CandidateCopyTransformInput,
): Promise<CandidateCopyTransformResult> {
  const validated = validateTransformInputs(input);
  const { slot, now } = validated;
  const baselineInspection = inspectCandidateCopySnapshot({
    slot,
    volumes: input.volumes,
    snapshot: input.snapshot,
    catalogue: input.catalogue,
  });

  const tables: Record<string, CandidateCopyTableState> = {};
  for (const [name, state] of Object.entries(input.snapshot.tables)) {
    tables[name] = cloneTableState(state, name in MANAGED_TABLES);
  }
  const rowsOf = (table: string): CandidateCopyRow[] =>
    (tables[table] as CandidateCopyRowBackedTable).rows as CandidateCopyRow[];
  const forEachRow = (
    table: string,
    mutate: (row: CandidateCopyRow, rowId: string) => void,
  ) => {
    const pk = (MANAGED_TABLES[table] as { pk: string }).pk;
    for (const row of rowsOf(table)) {
      mutate(row, requireRowId(row[pk], table, pk));
    }
  };
  const inertKeys: KeyMaterial = {
    ...validated,
    inertNonceHex: randomBytes(32).toString("hex"),
  };
  let tdk1RecryptedRows = 0;
  let encV2RecryptedValues = 0;
  let twoFactorRecryptedRows = 0;

  forEachRow("public.account", (row) => {
    row.access_token = null;
    row.refresh_token = null;
    row.id_token = null;
  });
  forEachRow("public.apikey", (row) => {
    row.enabled = false;
  });
  forEachRow("public.api_key", (row) => {
    if (row.disabled_at === null || row.disabled_at === undefined) {
      row.disabled_at = new Date(now.getTime());
      row.disabled_reason = row.disabled_reason ?? "candidate_copy_scrub";
    }
  });

  const twoFactorUserIds = new Set<string>();
  for (const row of rowsOf("public.two_factor")) {
    await rotateTwoFactorRow(
      row,
      validated.baselineAuthSecret,
      validated.candidateAuthSecret,
    );
    twoFactorUserIds.add(row.user_id as string);
    twoFactorRecryptedRows += 1;
  }
  for (const user of rowsOf("public.user")) {
    if (user.two_factor_enabled && !twoFactorUserIds.has(user.id as string)) {
      fail(
        "INVARIANT_VIOLATION",
        `User ${String(user.id)} has two_factor_enabled=true but no corresponding two_factor row`,
        {
          table: "public.user",
          rowId: String(user.id),
          column: "two_factor_enabled",
        },
      );
    }
  }

  // External plugins are disabled; only the intrinsic auth.password rows keep their state.
  forEachRow("public.instance_plugin_config", (row) => {
    if (!isIntrinsicPasswordRow(row)) row.enabled = false;
  });
  forEachRow("public.identity_connection", (row) => {
    row.enabled = false;
  });
  forEachRow("public.scim_connection", (row) => {
    row.enabled = false;
    row.token_hash = null;
    row.token_prefix = null;
  });
  forEachRow("public.instance_setting", (row) => {
    row.metrics_token_hash = null;
    row.metrics_token_rotated_at = null;
    row.setup_token_hash = null;
    row.setup_token_expires_at = null;
  });
  forEachRow("public.webhook", (row) => {
    row.active = false;
    row.disabled_at ??= new Date(now.getTime());
    row.disabled_reason ??= "manual";
  });

  for (const spec of SECRET_COLUMNS) {
    forEachRow(spec.table, (row, rowId) => {
      const value = row[spec.column];
      if (value === null || value === undefined) {
        if (!spec.nullable) {
          fail(
            "INVALID_ENVELOPE_SHAPE",
            `${spec.table}.${spec.column} is NOT NULL and must be present`,
            { table: spec.table, rowId, column: spec.column },
          );
        }
        row[spec.column] = null;
        return;
      }
      row[spec.column] = rotateSecretToInert(spec, rowId, value, inertKeys);
      if (spec.kind === "tdk1") tdk1RecryptedRows += 1;
      else encV2RecryptedValues += 1;
    });
  }

  forEachRow("public.customer_invitation_delivery", (row) => {
    if (row.envelope !== null && row.envelope !== undefined) {
      verifyCustomerInvitationDeliveryOuterEnvelope(
        row,
        validated.baselineEncryptionKey,
      );
    }
    const live =
      row.state === "queued" ||
      row.state === "sending" ||
      [
        row.envelope,
        row.credential_hash,
        row.owner_id,
        row.lease_id,
        row.lease_expires_at,
      ].some((value) => value !== null);
    if (live) {
      row.state = "suppressed";
      row.envelope = null;
      row.credential_hash = null;
      row.owner_id = null;
      row.lease_id = null;
      row.lease_expires_at = null;
      row.terminal_code = "inert";
      row.updated_at = new Date(now.getTime());
    }
  });
  forEachRow("public.invitation", (row) => {
    if (row.status === "pending") row.status = "canceled";
    row.credential_hash = null;
  });
  forEachRow("public.automation", (row) => {
    row.enabled = false;
  });
  // Existing configuration rows are disabled; this says nothing about jobs without a row.
  forEachRow("public.instance_job_configuration", (row) => {
    row.enabled = false;
  });

  const settle = (
    table: string,
    moves: Readonly<Record<string, string>>,
  ): void => {
    forEachRow(table, (row) => {
      const next = moves[row.state as string];
      if (next !== undefined) row.state = next;
    });
  };
  settle("public.outbox", { pending: "delivered" });
  settle("public.notification_delivery", { pending: "suppressed" });
  settle("public.webhook_delivery", { pending: "cancelled" });
  settle("public.automation_run", {
    pending: "abandoned",
    running: "abandoned",
  });
  settle("public.import_run", {
    queued: "failed",
    running: "failed",
    paused: "failed",
  });

  const scrubbedTransientRows =
    {} as CandidateCopyVerificationSummary["scrubbedTransientRows"];
  for (const table of CANDIDATE_COPY_SCRUB_DELETABLE_TABLES) {
    scrubbedTransientRows[table] = rowsOf(table).length;
    (tables[table] as CandidateCopyRowBackedTable).rows = [];
  }

  const snapshot: CandidateCopyDatabaseSnapshot = {
    catalogueHash: input.snapshot.catalogueHash,
    tables,
    attachments: { ...input.snapshot.attachments },
  };
  const verification = await verifyTransformedCandidateCopySnapshot({
    slot,
    volumes: input.volumes,
    baselineEncryptionKey: validated.baselineEncryptionKey,
    candidateEncryptionKey: validated.candidateEncryptionKey,
    baselineAuthSecret: validated.baselineAuthSecret,
    candidateAuthSecret: validated.candidateAuthSecret,
    catalogue: input.catalogue,
    runtimeObservation: input.runtimeObservation,
    baselineSnapshot: input.snapshot,
    candidateSnapshot: snapshot,
  });

  return {
    ...verification,
    baselineInspection,
    snapshot,
    summary: {
      tdk1RecryptedRows,
      encV2RecryptedValues,
      twoFactorRecryptedRows,
      scrubbedTransientRows,
      preservedTableCount: Object.keys(tables).filter(
        (name) => !(name in MANAGED_TABLES),
      ).length,
    },
  };
}

/**
 * Independently verifies a candidate snapshot against its baseline, the old/new keys and the
 * runtime observation, returning the proof structures consumed by the candidate selector.
 */
export async function verifyTransformedCandidateCopySnapshot(options: {
  slot: string;
  volumes: CandidateCopyVolumesInput;
  baselineEncryptionKey: string;
  candidateEncryptionKey: string;
  baselineAuthSecret: string;
  candidateAuthSecret: string;
  catalogue: readonly CandidateCopyCatalogueTable[];
  runtimeObservation: CandidateCopyRuntimeObservation;
  baselineSnapshot: CandidateCopyDatabaseSnapshot;
  candidateSnapshot: CandidateCopyDatabaseSnapshot;
}): Promise<CandidateCopyVerificationResult> {
  const slot = requireNonEmptyTrimmedString(options.slot, "slot");
  const keys = normalizeKeyMaterial(options);
  const runtime = assertRuntimeObservation(options.runtimeObservation, slot);
  const common = {
    slot,
    volumes: options.volumes,
    catalogue: options.catalogue,
  };
  const baselineInspection = inspectCandidateCopySnapshot({
    ...common,
    snapshot: options.baselineSnapshot,
  });
  const candidateInspection = inspectCandidateCopySnapshot({
    ...common,
    snapshot: options.candidateSnapshot,
    baselineSnapshotForDiff: options.baselineSnapshot,
  });

  for (const [table, baseline] of Object.entries(baselineInspection.tables)) {
    const candidate = candidateInspection.tables[table];
    if (!candidate) {
      fail("INVARIANT_VIOLATION", `Candidate inspection is missing ${table}`, {
        table,
      });
    }
    if (candidate.observation !== baseline.observation) {
      fail(
        "INVARIANT_VIOLATION",
        `Observation kind of ${table} changed from ${baseline.observation} to ${candidate.observation}`,
        { table },
      );
    }
    if (DELETABLE_TABLES.has(table)) {
      if (candidate.rowCount !== 0) {
        fail(
          "INVARIANT_VIOLATION",
          `Transient table ${table} must have 0 rows after transform (found ${candidate.rowCount})`,
          { table },
        );
      }
    } else if (candidate.rowCount !== baseline.rowCount) {
      fail(
        "INVARIANT_VIOLATION",
        `Row count drift on ${table}: baseline=${baseline.rowCount}, candidate=${candidate.rowCount}`,
        { table },
      );
    } else if (
      candidate.protectedFingerprint !== baseline.protectedFingerprint
    ) {
      fail(
        "INVARIANT_VIOLATION",
        `Protected column fingerprint drift on ${table}`,
        { table },
      );
    }
  }
  if (
    candidateInspection.attachments.objectCount !==
      baselineInspection.attachments.objectCount ||
    candidateInspection.attachments.fingerprint !==
      baselineInspection.attachments.fingerprint
  ) {
    fail(
      "INVARIANT_VIOLATION",
      "Attachment count or fingerprint drifted between baseline and candidate",
    );
  }

  const rows = (table: string) =>
    requireManagedRows(options.candidateSnapshot, table);
  const baselineRows = (table: string) =>
    requireManagedRows(options.baselineSnapshot, table);

  // MFA: same TOTP secret and backup codes under the candidate auth secret, unreadable under the old.
  const baselineTwoFactor = new Map(
    baselineRows("public.two_factor").map((row) => [String(row.id), row]),
  );
  const tally = { oldKeyReadable: 0, unreadable: 0, mfaOldKeyReadable: 0 };
  let firstFailure: CandidateCopyTransformError | undefined;
  const guarded = async (
    counter: "oldKeyReadable" | "unreadable" | "mfaOldKeyReadable",
    check: () => unknown,
  ): Promise<boolean> => {
    try {
      await check();
      return true;
    } catch (error) {
      if (!(error instanceof CandidateCopyTransformError)) throw error;
      firstFailure ??= error;
      if (error.code === "OLD_KEY_STILL_DECRYPTS") {
        tally[counter === "unreadable" ? "oldKeyReadable" : counter] += 1;
        if (counter === "mfaOldKeyReadable") tally.oldKeyReadable += 1;
      } else {
        tally.unreadable += 1;
      }
      return false;
    }
  };
  let candidateReadableRows = 0;
  for (const row of rows("public.two_factor")) {
    const rowId = requireRowId(row.id, "public.two_factor", "id");
    const original = baselineTwoFactor.get(rowId);
    let rowOk = true;
    for (const column of ["secret", "backup_codes"] as const) {
      const context = { table: "public.two_factor", rowId, column };
      rowOk =
        (await guarded("mfaOldKeyReadable", async () => {
          const expected = await decryptBetterAuthCiphertext(
            original?.[column],
            keys.baselineAuthSecret,
            context,
            "OLD_KEY_DECRYPT_FAILED",
          );
          const actual = await decryptBetterAuthCiphertext(
            row[column],
            keys.candidateAuthSecret,
            context,
            "NEW_KEY_VERIFY_FAILED",
          );
          const normalise = (value: string) =>
            column === "backup_codes"
              ? JSON.stringify(parseValidatedBackupCodes(value, context))
              : value;
          if (normalise(actual) !== normalise(expected)) {
            fail(
              "NEW_KEY_VERIFY_FAILED",
              `Candidate two_factor row ${rowId} decrypted to different TOTP secret or backup_codes than baseline`,
              context,
            );
          }
          await assertOldAuthSecretCannotDecrypt(
            row[column] as string,
            keys.baselineAuthSecret,
            context,
          );
        })) && rowOk;
    }
    if (rowOk) candidateReadableRows += 1;
  }
  const users = rows("public.user");
  const mfaUserIds = new Set(
    rows("public.two_factor").map((row) => row.user_id),
  );
  for (const user of users) {
    if (user.two_factor_enabled && !mfaUserIds.has(user.id)) {
      fail(
        "INVARIANT_VIOLATION",
        `MFA-enabled user ${String(user.id)} is missing a two_factor row on candidate snapshot`,
        {
          table: "public.user",
          rowId: String(user.id),
          column: "two_factor_enabled",
        },
      );
    }
  }

  // Encrypted columns: readable only under the candidate key and equal to the inert credential.
  const usable = {
    usablePluginSecrets: 0,
    usableIdentityClientSecrets: 0,
    usableWebhookSecrets: 0,
    usableNotificationSecrets: 0,
    usableImportSourceCredentials: 0,
  };
  for (const spec of SECRET_COLUMNS) {
    for (const row of rows(spec.table)) {
      const value = row[spec.column];
      if (value === null || value === undefined) {
        if (!spec.nullable) {
          fail(
            "INVALID_ENVELOPE_SHAPE",
            `${spec.table}.${spec.column} is NOT NULL and must be present`,
            { table: spec.table, column: spec.column },
          );
        }
        continue;
      }
      const rowId = requireRowId(row.id, spec.table, spec.column);
      await guarded("unreadable", () => {
        if (isSecretUsable(spec, rowId, value, keys)) usable[spec.usable] += 1;
      });
    }
  }
  if (firstFailure) throw firstFailure;
  if (
    tally.oldKeyReadable !== 0 ||
    tally.unreadable !== 0 ||
    tally.mfaOldKeyReadable !== 0
  ) {
    fail("INVARIANT_VIOLATION", "Envelope readability counters are not zero");
  }

  // Intrinsic auth: password sign-in stays exactly as in the baseline; nothing else is enabled.
  const pluginRows = rows("public.instance_plugin_config");
  const intrinsic = candidateInspection.intrinsicAuthState;
  if (
    JSON.stringify(intrinsic) !==
    JSON.stringify(baselineInspection.intrinsicAuthState)
  ) {
    fail(
      "INVARIANT_VIOLATION",
      "Intrinsic auth.password state changed between baseline and candidate",
      { table: "public.instance_plugin_config" },
    );
  }
  const baselinePlugins = new Map(
    baselineRows("public.instance_plugin_config").map((row) => [
      String(row.id),
      row,
    ]),
  );
  for (const row of pluginRows) {
    const original = baselinePlugins.get(String(row.id));
    if (original && isIntrinsicPasswordRow(original)) {
      if (row.enabled !== original.enabled) {
        fail(
          "INVARIANT_VIOLATION",
          "An intrinsic auth.password row changed its enabled state",
          { table: "public.instance_plugin_config", rowId: String(row.id) },
        );
      }
    }
  }
  const configuredWithoutRow = (pluginId: string) =>
    !pluginRows.some(
      (row) =>
        row.plugin_id === pluginId &&
        row.scope === "instance" &&
        (row.portal_scope === "both" || row.portal_scope === "agent"),
    );
  const enabledNonPasswordAuthPluginRows = pluginRows.filter(
    (row) =>
      typeof row.plugin_id === "string" &&
      row.plugin_id.startsWith("auth.") &&
      row.plugin_id !== INTRINSIC_PASSWORD_PLUGIN_ID &&
      row.enabled === true,
  ).length;
  if (enabledNonPasswordAuthPluginRows !== 0) {
    fail(
      "INVARIANT_VIOLATION",
      `Non-password auth plugin rows are still enabled: ${enabledNonPasswordAuthPluginRows}`,
      { table: "public.instance_plugin_config" },
    );
  }
  const enabledExternalPluginConfigs = pluginRows.filter(
    (row) => !isIntrinsicPasswordRow(row) && row.enabled === true,
  ).length;

  const count = (table: string, test: (row: CandidateCopyRow) => boolean) =>
    rows(table).filter(test).length;
  const isNullish = (value: unknown) => value === null || value === undefined;
  const snapshotRows = (table: string) => rows(table).length;

  const credentialsProof: CandidateCopyCredentialsProof = {
    activeSessions: snapshotRows("public.session"),
    verificationRows: snapshotRows("public.verification"),
    stepUpConfirmations: snapshotRows("public.step_up_confirmation"),
    invitationContinuations: snapshotRows(
      "public.customer_invitation_auth_continuation",
    ),
    oauthTokensPresent: count(
      "public.account",
      (row) =>
        !isNullish(row.access_token) ||
        !isNullish(row.refresh_token) ||
        !isNullish(row.id_token),
    ),
    enabledBetterAuthApiKeys: count(
      "public.apikey",
      (row) => row.enabled === true,
    ),
    activeWorkspaceApiKeys: count("public.api_key", (row) =>
      isNullish(row.disabled_at),
    ),
    enabledExternalPluginConfigs,
    enabledIdentityConnections: count(
      "public.identity_connection",
      (row) => row.enabled === true,
    ),
    enabledScimConnections: count(
      "public.scim_connection",
      (row) => row.enabled === true,
    ),
    activeScimTokens: count(
      "public.scim_connection",
      (row) => !isNullish(row.token_hash) || !isNullish(row.token_prefix),
    ),
    activeSetupOrMetricsTokens: count(
      "public.instance_setting",
      (row) =>
        !isNullish(row.metrics_token_hash) ||
        !isNullish(row.metrics_token_rotated_at) ||
        !isNullish(row.setup_token_hash) ||
        !isNullish(row.setup_token_expires_at),
    ),
  };
  for (const [name, value] of Object.entries(credentialsProof)) {
    if (value !== 0) {
      fail(
        "INVARIANT_VIOLATION",
        `Credential scrub invariant failed: ${name}=${value}`,
      );
    }
  }

  const outboundProof: CandidateCopyOutboundProof = {
    enabledInstanceJobs: count(
      "public.instance_job_configuration",
      (row) => row.enabled === true,
    ),
    enabledAutomations: count(
      "public.automation",
      (row) => row.enabled === true,
    ),
    activeWebhooks: count(
      "public.webhook",
      (row) =>
        row.active === true ||
        isNullish(row.disabled_at) ||
        isNullish(row.disabled_reason),
    ),
    ...usable,
    pendingOutbox: count("public.outbox", (row) => row.state === "pending"),
    pendingNotificationDeliveries: count(
      "public.notification_delivery",
      (row) => row.state === "pending",
    ),
    pendingWebhookDeliveries: count(
      "public.webhook_delivery",
      (row) => row.state === "pending",
    ),
    pendingCustomerInvitationDeliveries: count(
      "public.customer_invitation_delivery",
      (row) =>
        row.state === "queued" ||
        row.state === "sending" ||
        [
          row.envelope,
          row.credential_hash,
          row.owner_id,
          row.lease_id,
          row.lease_expires_at,
        ].some((value) => !isNullish(value)),
    ),
    pendingCustomerInvitations: count(
      "public.invitation",
      (row) => row.status === "pending" || !isNullish(row.credential_hash),
    ),
    activeAutomationRuns: count(
      "public.automation_run",
      (row) => row.state === "pending" || row.state === "running",
    ),
    activeImportRuns: count(
      "public.import_run",
      (row) =>
        row.state === "queued" ||
        row.state === "running" ||
        row.state === "paused",
    ),
  };
  for (const [name, value] of Object.entries(outboundProof)) {
    if (value !== 0) {
      fail(
        "INVARIANT_VIOLATION",
        `Outbound scrub invariant failed: ${name}=${value}`,
      );
    }
  }

  const hasAny = (...values: unknown[]) =>
    values.some((value) => !isNullish(value));
  return {
    baselineInspection,
    candidateInspection,
    credentialsProof,
    outboundProof,
    selectorCredentials: {
      sessions: credentialsProof.activeSessions,
      verifications: credentialsProof.verificationRows,
      stepUpConfirmations: credentialsProof.stepUpConfirmations,
      activeApiKeys:
        credentialsProof.enabledBetterAuthApiKeys +
        credentialsProof.activeWorkspaceApiKeys,
      accountProviderTokens: credentialsProof.oauthTokensPresent,
      invitationCredentials: outboundProof.pendingCustomerInvitations,
      authContinuations: credentialsProof.invitationContinuations,
      scimTokens: credentialsProof.activeScimTokens,
      metricsTokens: count("public.instance_setting", (row) =>
        hasAny(row.metrics_token_hash, row.metrics_token_rotated_at),
      ),
      setupTokens: count("public.instance_setting", (row) =>
        hasAny(row.setup_token_hash, row.setup_token_expires_at),
      ),
      oldKeyEnvelopes: tally.oldKeyReadable,
      unreadableEnvelopes: tally.unreadable,
    },
    selectorOutbound: {
      enabledIdentityConnections: credentialsProof.enabledIdentityConnections,
      enabledScimConnections: credentialsProof.enabledScimConnections,
      enabledExternalPlugins: credentialsProof.enabledExternalPluginConfigs,
      activeWebhooks: outboundProof.activeWebhooks,
      enabledAutomations: outboundProof.enabledAutomations,
      runnableJobHandlers: runtime.runnableJobHandlers,
      actionableOutboxEvents: outboundProof.pendingOutbox,
      pendingNotificationDeliveries:
        outboundProof.pendingNotificationDeliveries,
      pendingWebhookDeliveries: outboundProof.pendingWebhookDeliveries,
      actionableAutomationRuns: outboundProof.activeAutomationRuns,
      actionableInvitationDeliveries:
        outboundProof.pendingCustomerInvitationDeliveries,
      runnableImportRuns: outboundProof.activeImportRuns,
    },
    selectorPreservation: toSelectorPreservationProof(
      options.catalogue,
      candidateInspection,
    ),
    localAuthResolutionProof: {
      agentStoredPasswordEnabled: true,
      customerStoredPasswordEnabled: intrinsic.customerPasswordEnabled,
      enabledNonPasswordAuthPluginRows: 0,
      agentStoredMagicLinkDefaultedWithoutRow:
        configuredWithoutRow("auth.magic-link"),
      agentStoredEmailOtpDefaultedWithoutRow:
        configuredWithoutRow("auth.email-otp"),
      // assertRuntimeObservation already guarantees the flag is true.
      nonPasswordLocalAuthSuppressedByRuntimeRole: true,
    },
    selectorIntrinsicAuth: {
      allowedPluginIds: ["auth.password"],
      storedPasswordRows: intrinsic.storedPasswordRows,
      enabledPasswordRows: intrinsic.enabledPasswordRows,
      agentPasswordEnabled: true,
      customerPasswordEnabled: intrinsic.customerPasswordEnabled,
    },
    mfaProof: {
      mode: "reencrypted",
      storedRows: rows("public.two_factor").length,
      enabledUsers: users.filter((user) => user.two_factor_enabled === true)
        .length,
      candidateReadableRows,
      baselineReadableRows: tally.mfaOldKeyReadable,
    },
  };
}

function assertNoAliasing(
  persisted: CandidateCopyDatabaseSnapshot,
  sources: readonly CandidateCopyDatabaseSnapshot[],
): void {
  const alias = (what: string): never =>
    fail(
      "INVARIANT_VIOLATION",
      `reloadSnapshot returned in-memory data (${what}) instead of freshly read rows`,
    );
  for (const source of sources) {
    if (persisted === source) alias("snapshot");
    if (persisted.tables === source.tables) alias("tables map");
    for (const [name, state] of Object.entries(persisted.tables)) {
      const other = source.tables[name];
      if (!other) continue;
      if (state === other) alias(`table state ${name}`);
      if (!("rows" in state) || !("rows" in other)) continue;
      if (state.rows === other.rows) alias(`rows array ${name}`);
      const known = new Set<unknown>(other.rows);
      if (state.rows?.some((row) => known.has(row)))
        alias(`row object ${name}`);
    }
  }
}

function assertPersistedMatchesPrepared(
  prepared: CandidateCopyDatabaseSnapshot,
  persisted: CandidateCopyDatabaseSnapshot,
): void {
  for (const table of Object.keys(MANAGED_TABLES)) {
    const left = requireManagedRows(prepared, table);
    const right = requireManagedRows(persisted, table);
    if (
      computeProtectedTableFingerprint(table, left, []) !==
      computeProtectedTableFingerprint(table, right, [])
    ) {
      fail(
        "INVARIANT_VIOLATION",
        `Persisted ${table} differs from the prepared candidate rows (apply was partial or a no-op)`,
        { table },
      );
    }
  }
}

/**
 * Prepares the candidate rows in memory, applies them inside a caller-owned transaction,
 * re-reads the persisted rows in that same transaction and re-verifies them independently.
 * A no-op or partial `applyTransformedSnapshot` therefore rejects, and the caller's
 * `runInTransaction` must roll back on rejection. This function never opens a transaction itself.
 */
export async function applyCandidateCopyTransformInTransaction<
  TCommitReceipt = void,
>(
  boundary: CandidateCopyTransactionalBoundary<TCommitReceipt>,
  input: Omit<CandidateCopyTransformInput, "snapshot">,
): Promise<CandidateCopyTransformResult & { commitReceipt: TCommitReceipt }> {
  return boundary.runInTransaction(async (session) => {
    const baseline = await session.loadSnapshot();
    const prepared = await transformCandidateCopySnapshot({
      ...input,
      snapshot: baseline,
    });
    const commitReceipt = await session.applyTransformedSnapshot(
      prepared.snapshot,
    );
    const persisted = await session.reloadSnapshot();
    assertNoAliasing(persisted, [prepared.snapshot, baseline]);
    assertPersistedMatchesPrepared(prepared.snapshot, persisted);
    const verification = await verifyTransformedCandidateCopySnapshot({
      ...input,
      baselineSnapshot: baseline,
      candidateSnapshot: persisted,
    });
    return {
      ...prepared,
      ...verification,
      snapshot: persisted,
      commitReceipt,
    };
  });
}

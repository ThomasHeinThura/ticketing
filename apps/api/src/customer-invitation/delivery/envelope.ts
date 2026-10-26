import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
} from "../../identity/client-secret";
import { hashCredential } from "../logic";
import {
  type CustomerInvitationDeliveryKeyring,
  customerInvitationDeliveryKeyring,
  type DeliveryKey,
} from "./keyring";

const PURPOSE = "taskdesk:customer-invitation-delivery:v2";
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INNER_IV_BYTES = 12;
const INNER_TAG_BYTES = 16;

export type CustomerInvitationDeliveryEnvelope = {
  version: 2;
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
  ownerId: string;
  keyId: string;
  inner: {
    iv: string;
    ciphertext: string;
    tag: string;
  };
};

export function customerInvitationDeliveryAad(input: {
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
  ownerId: string;
  keyId: string;
}) {
  return `${PURPOSE}:${input.deliveryId}:${input.invitationId}:${input.credentialHash}:${input.ownerId}:${input.keyId}`;
}

function customerInvitationDeliveryOuterAad(input: {
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
}) {
  return `${PURPOSE}:${input.deliveryId}:${input.invitationId}:${input.credentialHash}`;
}

function validateBindings(input: {
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
  ownerId: string;
  keyId: string;
}) {
  if (
    !input.deliveryId ||
    !input.invitationId ||
    !HASH_PATTERN.test(input.credentialHash) ||
    !UUID_PATTERN.test(input.ownerId) ||
    !UUID_PATTERN.test(input.keyId)
  )
    throw new Error("Customer invitation delivery envelope is invalid");
}

/** The persistent master key sees only an opaque inner ciphertext, never the credential. */
export function encryptDeliveryEnvelope(input: {
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
  credential: string;
  key: DeliveryKey;
}): string {
  validateBindings({
    ...input,
    ownerId: input.key.ownerId,
    keyId: input.key.keyId,
  });
  if (
    !CREDENTIAL_PATTERN.test(input.credential) ||
    hashCredential(input.credential) !== input.credentialHash ||
    input.key.id !== input.deliveryId ||
    input.key.key.length !== 32
  )
    throw new Error("Customer invitation delivery envelope is invalid");

  const iv = randomBytes(INNER_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", input.key.key, iv);
  cipher.setAAD(
    Buffer.from(
      customerInvitationDeliveryAad({
        deliveryId: input.deliveryId,
        invitationId: input.invitationId,
        credentialHash: input.credentialHash,
        ownerId: input.key.ownerId,
        keyId: input.key.keyId,
      }),
      "utf8",
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(input.credential, "utf8"),
    cipher.final(),
  ]);
  const payload: CustomerInvitationDeliveryEnvelope = {
    version: 2,
    deliveryId: input.deliveryId,
    invitationId: input.invitationId,
    credentialHash: input.credentialHash,
    ownerId: input.key.ownerId,
    keyId: input.key.keyId,
    inner: {
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    },
  };
  const outerAad = customerInvitationDeliveryOuterAad({
    deliveryId: input.deliveryId,
    invitationId: input.invitationId,
    credentialHash: input.credentialHash,
  });
  return encryptIdentityClientSecret(
    outerAad,
    JSON.stringify(payload),
  ).toString("base64url");
}

function decodeOuterEnvelope(input: {
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
  envelope: string;
}): CustomerInvitationDeliveryEnvelope {
  const plaintext = decryptIdentityClientSecret(
    customerInvitationDeliveryOuterAad(input),
    Buffer.from(input.envelope, "base64url"),
  );
  const parsed: unknown = JSON.parse(plaintext);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Invalid payload");
  const payload = parsed as Partial<CustomerInvitationDeliveryEnvelope>;
  const keys = Object.keys(parsed).sort();
  if (
    keys.join(",") !==
      "credentialHash,deliveryId,inner,invitationId,keyId,ownerId,version" ||
    payload.version !== 2 ||
    payload.deliveryId !== input.deliveryId ||
    payload.invitationId !== input.invitationId ||
    payload.credentialHash !== input.credentialHash ||
    typeof payload.ownerId !== "string" ||
    typeof payload.keyId !== "string" ||
    typeof payload.inner !== "object" ||
    payload.inner === null
  )
    throw new Error("Invalid payload");
  validateBindings({
    deliveryId: payload.deliveryId,
    invitationId: payload.invitationId,
    credentialHash: payload.credentialHash,
    ownerId: payload.ownerId,
    keyId: payload.keyId,
  });
  const inner = payload.inner as Partial<
    CustomerInvitationDeliveryEnvelope["inner"]
  >;
  if (
    Object.keys(payload.inner).sort().join(",") !== "ciphertext,iv,tag" ||
    typeof inner.iv !== "string" ||
    typeof inner.ciphertext !== "string" ||
    typeof inner.tag !== "string"
  )
    throw new Error("Invalid payload");
  const iv = Buffer.from(inner.iv, "base64url");
  const ciphertext = Buffer.from(inner.ciphertext, "base64url");
  const tag = Buffer.from(inner.tag, "base64url");
  if (
    iv.length !== INNER_IV_BYTES ||
    ciphertext.length === 0 ||
    ciphertext.length > 128 ||
    tag.length !== INNER_TAG_BYTES
  )
    throw new Error("Invalid payload");
  return payload as CustomerInvitationDeliveryEnvelope;
}

/** Decrypts only with this process's still-live key after the caller holds row locks. */
export function decryptDeliveryEnvelope(input: {
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
  envelope: string;
  ownerId: string;
  keyring?: CustomerInvitationDeliveryKeyring;
}): CustomerInvitationDeliveryEnvelope & { credential: string } {
  try {
    const payload = decodeOuterEnvelope(input);
    if (payload.ownerId !== input.ownerId) throw new Error("Owner mismatch");
    const key = (input.keyring ?? customerInvitationDeliveryKeyring).get(
      input.deliveryId,
      payload.ownerId,
      payload.keyId,
    );
    if (!key) throw new Error("Delivery key unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.key,
      Buffer.from(payload.inner.iv, "base64url"),
    );
    decipher.setAAD(
      Buffer.from(
        customerInvitationDeliveryAad({
          deliveryId: payload.deliveryId,
          invitationId: payload.invitationId,
          credentialHash: payload.credentialHash,
          ownerId: payload.ownerId,
          keyId: payload.keyId,
        }),
        "utf8",
      ),
    );
    decipher.setAuthTag(Buffer.from(payload.inner.tag, "base64url"));
    const credential = Buffer.concat([
      decipher.update(Buffer.from(payload.inner.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    if (
      !CREDENTIAL_PATTERN.test(credential) ||
      hashCredential(credential) !== input.credentialHash
    )
      throw new Error("Credential mismatch");
    return { ...payload, credential };
  } catch {
    throw new Error("Customer invitation delivery envelope is unavailable");
  }
}

/** Re-encrypts only the opaque inner ciphertext under the current outer key. */
export function reencryptDeliveryEnvelope(input: {
  deliveryId: string;
  invitationId: string;
  credentialHash: string;
  envelope: string;
}): string {
  const payload = decodeOuterEnvelope(input);
  const outerAad = customerInvitationDeliveryOuterAad({
    deliveryId: input.deliveryId,
    invitationId: input.invitationId,
    credentialHash: input.credentialHash,
  });
  return encryptIdentityClientSecret(
    outerAad,
    JSON.stringify(payload),
  ).toString("base64url");
}

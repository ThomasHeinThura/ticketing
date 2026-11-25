import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import {
  hashApiKeySecretArgon2id,
  isArgon2idHash,
  verifyApiKeySecret,
} from "../api-key/secret-hash";

// argon2id runs on the libuv pool via node:crypto, so a sign-in burst no longer blocks the event loop.
export const hashPassword = hashApiKeySecretArgon2id;

// bcrypt reads at most 72 bytes (incl. the NUL terminator), so a 72+ byte password cannot be safely rehashed.
const BCRYPT_MAX_BYTES = 72;

// Inline source keeps this working in the esbuild dist bundle (no separate worker file to emit).
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const bcrypt = require(workerData.bcryptPath);
parentPort.on("message", async ({ id, password, hash }) => {
  try {
    parentPort.postMessage({ id, valid: await bcrypt.compare(password, hash) });
  } catch {
    parentPort.postMessage({ id, valid: false });
  }
});
`;

const POOL_SIZE = 2;
type Pending = (valid: boolean) => void;
type Slot = { worker: Worker; pending: Map<number, Pending> };
const pool: Slot[] = [];
let nextId = 0;

function spawn(): Slot {
  const bcryptPath = createRequire(import.meta.url).resolve("bcryptjs");
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { bcryptPath },
  });
  worker.unref();
  const slot: Slot = { worker, pending: new Map() };
  const drop = () => {
    for (const settle of slot.pending.values()) settle(false);
    slot.pending.clear();
    const index = pool.indexOf(slot);
    if (index >= 0) pool.splice(index, 1);
  };
  worker.on("message", ({ id, valid }: { id: number; valid: boolean }) => {
    slot.pending.get(id)?.(valid);
    slot.pending.delete(id);
  });
  worker.on("error", drop);
  worker.on("exit", drop);
  return slot;
}

function compareLegacyBcrypt(password: string, hash: string): Promise<boolean> {
  if (pool.length < POOL_SIZE) pool.push(spawn());
  const slot = pool.reduce((a, b) =>
    a.pending.size <= b.pending.size ? a : b,
  );
  const id = nextId++;
  return new Promise((resolve) => {
    slot.pending.set(id, resolve);
    slot.worker.postMessage({ id, password, hash });
  });
}

/** `needsRehash` is true only after a successful verify of a legacy bcrypt hash. */
export async function verifyPassword(
  hash: string,
  password: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (isArgon2idHash(hash)) return verifyApiKeySecret(password, hash);
  if (!hash.startsWith("$2")) return { valid: false, needsRehash: false };
  const valid = await compareLegacyBcrypt(password, hash);
  return {
    valid,
    needsRehash: valid && Buffer.byteLength(password) < BCRYPT_MAX_BYTES,
  };
}

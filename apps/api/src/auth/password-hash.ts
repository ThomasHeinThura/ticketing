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
const loaded = import(workerData.bcryptUrl).then((module) => module.default ?? module);
parentPort.on("message", async ({ id, password, hash }) => {
  try {
    const bcrypt = await loaded;
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
  // Resolved here, where node_modules is reachable; the eval'd worker has no module location.
  const bcryptUrl = import.meta.resolve("bcryptjs");
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    // Without this the worker inherits flags like --input-type=module, and the CommonJS source above crashes.
    execArgv: [],
    workerData: { bcryptUrl },
  });
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
    // An idle worker must not keep the process alive (CLI and seed scripts).
    if (slot.pending.size === 0) worker.unref();
  });
  worker.on("error", (error) => {
    // A crashed worker turns every legacy sign-in into "wrong password", so say why.
    console.error("bcrypt verify worker failed", error);
    drop();
  });
  worker.on("exit", drop);
  // After the listeners: attaching "message" re-refs the worker.
  worker.unref();
  return slot;
}

function compareLegacyBcrypt(password: string, hash: string): Promise<boolean> {
  // Grow only when every worker is busy, so no idle worker is ever spawned.
  if (pool.length < POOL_SIZE && pool.every((slot) => slot.pending.size > 0))
    pool.push(spawn());
  const slot = pool.reduce((a, b) =>
    a.pending.size <= b.pending.size ? a : b,
  );
  const id = nextId++;
  return new Promise((resolve) => {
    slot.pending.set(id, resolve);
    slot.worker.ref();
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

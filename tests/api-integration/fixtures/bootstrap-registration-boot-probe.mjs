import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// The caller sets registration flags before this process imports auth.ts.
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const outputPrefix = "BOOTSTRAP_REGISTRATION_RESULT:";
let phase = "auth-import";
let closeDatabasePool;

try {
  const { createApp } = await import("../../../apps/api/src/index.ts");
  const database = await import("../../../apps/api/src/database/index.ts");
  const setup = await import("../../../apps/api/src/instance/setup-token.ts");
  closeDatabasePool = database.closeDatabasePool;
  const require = createRequire(
    new URL("../../../apps/api/package.json", import.meta.url),
  );
  const { base32 } = require("@better-auth/utils/base32");
  const { createOTP } = require("@better-auth/utils/otp");

  const { app } = createApp();
  let client = 0;
  const clientIp = () => `198.51.100.${++client}`;
  const request = (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("host", "localhost:1337");
    return app.request(`http://localhost:1337${path}`, {
      ...init,
      headers,
    });
  };
  const signup = async (options = {}) => {
    const headers = new Headers({
      "content-type": "application/json",
      "x-forwarded-for": clientIp(),
    });
    if (options.setupToken) {
      headers.set("x-taskdesk-setup-token", options.setupToken);
    }
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: options.email ?? `probe-${randomUUID()}@example.com`,
        password: "Private-Probe-Password9!",
        name: "Bootstrap Probe",
        ...(options.invitationId ? { invitationId: options.invitationId } : {}),
      }),
    });
    let body = "";
    let message = null;
    if (response.status !== 200) {
      body = await response.text();
      try {
        const parsed = JSON.parse(body);
        message = typeof parsed.message === "string" ? parsed.message : null;
      } catch {
        // The parent reports only the generic assertion outcome.
      }
    }
    return { response, body, message };
  };

  phase = "issue-token";
  const token = await setup.ensureSetupToken();
  if (!token) throw new Error("no token");

  phase = "unclaimed-refusals";
  const unclaimedPlain = await signup();
  const unclaimedInvitation = await signup({
    invitationId: "probe-invalid-invitation",
  });

  phase = "valid-bootstrap";
  const proofMode = process.argv[2];
  const admitted = await signup(
    proofMode === "headless"
      ? { email: process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL }
      : { setupToken: token },
  );
  if (admitted.response.status !== 200) throw new Error("bootstrap denied");
  const user = await admitted.response.json();
  const sessionCookie = admitted.response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!sessionCookie) throw new Error("session unavailable");

  phase = "complete-factor";
  const enabled = await request("/api/auth/two-factor/enable", {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "content-type": "application/json",
      "x-forwarded-for": clientIp(),
    },
    body: JSON.stringify({
      password: "Private-Probe-Password9!",
      issuer: "TaskDesk",
    }),
  });
  if (enabled.status !== 200) throw new Error("factor enrollment denied");
  const { totpURI } = await enabled.json();
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) throw new Error("factor setup unavailable");
  const rawSecret = Buffer.from(base32.decode(secret)).toString("utf8");
  const code = await createOTP(rawSecret).totp();
  const verified = await request("/api/auth/two-factor/verify-totp", {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "content-type": "application/json",
      "x-forwarded-for": clientIp(),
    },
    body: JSON.stringify({ code }),
  });
  if (verified.status !== 200) throw new Error("factor verification denied");
  const setupCompleted = await setup.isSetupCompleted();
  if (!setupCompleted || !user.user?.id) throw new Error("setup incomplete");

  phase = "claimed-refusals";
  const claimedPlain = await signup();
  const claimedInvitation = await signup({
    invitationId: "probe-invalid-invitation",
  });

  const result = {
    unclaimedPlain: {
      status: unclaimedPlain.response.status,
      body: unclaimedPlain.body,
      message: unclaimedPlain.message,
    },
    unclaimedInvitation: {
      status: unclaimedInvitation.response.status,
      body: unclaimedInvitation.body,
      message: unclaimedInvitation.message,
    },
    bootstrapStatus: admitted.response.status,
    proofMode,
    setupCompleted,
    claimedPlain: {
      status: claimedPlain.response.status,
      body: claimedPlain.body,
      message: claimedPlain.message,
    },
    claimedInvitation: {
      status: claimedInvitation.response.status,
      body: claimedInvitation.body,
      message: claimedInvitation.message,
    },
  };
  process.stdout.write(`${outputPrefix}${JSON.stringify(result)}\n`);
} catch {
  process.stdout.write(`${outputPrefix}{"failedAt":"${phase}"}\n`);
  process.exitCode = 1;
} finally {
  if (closeDatabasePool) await closeDatabasePool();
}

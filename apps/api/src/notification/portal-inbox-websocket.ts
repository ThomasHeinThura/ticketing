import { upgradeWebSocket } from "@hono/node-server";
import { HTTPException } from "hono/http-exception";
import type { WSContext } from "hono/ws";
import { portalForHost } from "../auth";
import { customerPortalStateForUser } from "../feature-flag/enforce";
import { resolveIdentity } from "../permissions/resolve-identity";
import { authenticateApiRequest } from "../utils/authenticate-api-request";
import { addUserConnection, removeUserConnection } from "../ws";
import { checkWebSocketOrigin } from "../ws/origin-policy";
import { portalRealtimeAdmitted } from "./portal-inbox-repository";

const NOTIFICATION_CREATED = JSON.stringify({ type: "NOTIFICATION_CREATED" });

/** Accept only the payload-free invalidation understood by the portal inbox. */
export function portalNotificationSocketPayload(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      (parsed as { type?: unknown }).type !== "NOTIFICATION_CREATED"
    )
      return null;
    return NOTIFICATION_CREATED;
  } catch {
    return null;
  }
}

function customerNotificationSocket(ws: WSContext, userId: string): WSContext {
  return new Proxy(ws, {
    get(target, property, receiver) {
      if (property === "send")
        return (data: string | ArrayBuffer | Uint8Array) => {
          if (typeof data !== "string") return;
          const safe = portalNotificationSocketPayload(data);
          if (!safe) return;
          // P4R2-M2: an invalidation caused only by a project or workspace with the customer
          // portal off is not pushed (the inbox would show nothing new anyway).
          void portalRealtimeAdmitted(userId).then((admitted) => {
            if (admitted) target.send(safe);
          });
        };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function requireCustomerSocket(c: {
  req: { header(name: string): string | undefined };
  get(key: "userId"): unknown;
  get(key: "session"): unknown;
}) {
  const host = c.req.header("host") ?? null;
  const origin = c.req.header("origin") ?? null;
  const session = c.get("session") as { portal?: unknown } | null;
  const userId = c.get("userId");
  const originResult = checkWebSocketOrigin({
    host,
    origin,
    sessionPortal: session?.portal,
    hasSession: session !== null,
  });
  if (
    !originResult.allowed ||
    originResult.portal !== "customer" ||
    portalForHost(host) !== "customer" ||
    session?.portal !== "customer" ||
    typeof userId !== "string" ||
    !userId
  )
    throw new HTTPException(403, { message: "Forbidden" });

  const identity = await resolveIdentity({ userId, credential: "session" });
  if (identity?.side !== "customer")
    throw new HTTPException(403, { message: "Forbidden" });
  // P4R2-M2: no realtime channel while the portal is off for the customer's organisation; the
  // periodic re-check closes an open socket once it is switched off.
  if ((await customerPortalStateForUser(userId)) !== "on")
    throw new HTTPException(403, { message: "Forbidden" });
  return userId;
}

/** The global API guard handles initial authentication; this factory rechecks it on refresh. */
export function createPortalNotificationWebSocket() {
  return upgradeWebSocket(async (c) => {
    await authenticateApiRequest(c);
    const userId = await requireCustomerSocket(c);
    let conn: ReturnType<typeof addUserConnection> | null = null;

    return {
      onOpen(_event, ws) {
        conn = addUserConnection(
          userId,
          customerNotificationSocket(ws, userId),
          async () => {
            try {
              await authenticateApiRequest(c);
              return (await requireCustomerSocket(c)) === userId;
            } catch {
              return false;
            }
          },
        );
      },
      onMessage(event) {
        try {
          const raw =
            typeof event.data === "string"
              ? event.data
              : Buffer.isBuffer(event.data)
                ? event.data.toString()
                : null;
          if (raw) {
            const message = JSON.parse(raw) as { type?: unknown };
            // The client may keep the connection alive; no other frame is acted upon.
            if (message?.type === "ping") return;
          }
        } catch {
          // Malformed client frames are ignored.
        }
      },
      onClose() {
        if (conn) removeUserConnection(userId, conn);
      },
    };
  });
}

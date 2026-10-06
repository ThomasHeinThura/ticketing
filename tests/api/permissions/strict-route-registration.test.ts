import { describe, expect, it } from "vitest";
import { installStrictPolicyRegistration } from "../../../apps/api/src/permissions/strict-route-registration";

type FakeHandler = (c: object, next: () => Promise<void>) => unknown;

describe("strict endpoint registration", () => {
  it("runs after route middleware and validators but before the handler", async () => {
    const order: string[] = [];
    const route = {
      handlers: [] as FakeHandler[],
      on(_method: unknown, _path: unknown, ...handlers: FakeHandler[]) {
        this.handlers = handlers;
        return this;
      },
    };
    installStrictPolicyRegistration(route, async (_context, next) => {
      order.push("policy");
      return next();
    });

    route.on(
      ["POST"],
      "/resource/:id",
      async (_c, next) => {
        order.push("middleware");
        await next();
      },
      async (_c, next) => {
        order.push("validator");
        await next();
      },
      async () => {
        order.push("handler");
      },
    );

    const handlers = route.handlers;
    const dispatch = async (index: number): Promise<void> => {
      const handler = handlers[index];
      if (handler) await handler({}, () => dispatch(index + 1));
    };
    await dispatch(0);
    expect(order).toEqual(["middleware", "validator", "policy", "handler"]);
    expect(handlers).toHaveLength(3);
  });

  it("wraps direct method handlers without adding a router entry", async () => {
    let registered: FakeHandler | undefined;
    const route = {
      post(_path: string, handler: FakeHandler) {
        registered = handler;
        return this;
      },
    };
    const order: string[] = [];
    installStrictPolicyRegistration(route, async (_context, next) => {
      order.push("policy");
      return next();
    });

    route.post("/resource", async () => {
      order.push("handler");
    });
    await registered?.({}, async () => {});
    expect(order).toEqual(["policy", "handler"]);
  });
});

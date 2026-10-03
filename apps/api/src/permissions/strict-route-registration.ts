import { enforceRegisteredPolicy } from "./strict-policy-enforcement";

type Registration = (...args: unknown[]) => unknown;
type RouteHandler = (c: unknown, next: () => Promise<void>) => unknown;
type RouterSurface = Record<string, unknown>;
type RegisteredRoute = {
  readonly method: unknown;
  readonly path: unknown;
  readonly terminalHandler?: unknown;
};
type Enforcer = (
  c: unknown,
  next: () => Promise<unknown>,
  route?: RegisteredRoute,
) => unknown | Promise<unknown>;

const installed = new WeakSet<object>();
const directMethods = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "all",
] as const;

function withStrictTerminal(
  handlers: unknown[],
  enforce: Enforcer,
  route: RegisteredRoute,
): unknown[] {
  if (handlers.length === 0) return handlers;
  const lastIndex = handlers.length - 1;
  const terminal = handlers[lastIndex];
  if (typeof terminal !== "function") return handlers;

  const endpoint = terminal as RouteHandler;
  let wrapped: RouteHandler;
  wrapped = async (c: unknown, next: () => Promise<void>) =>
    enforce(c, () => endpoint(c, next) as never, {
      ...route,
      terminalHandler: wrapped,
    });
  handlers[lastIndex] = wrapped;
  return handlers;
}

/**
 * Decorate endpoint registration without adding router entries or changing middleware order.
 * OpenAPI routes call `on()` with declared middleware, validators, and then the handler; the
 * wrapper keeps that order and replaces only the terminal handler so policy evaluation sees
 * trusted middleware facts and parsed request data before application effects.
 */
export function installStrictPolicyRegistration<T extends object>(
  router: T,
  enforce: Enforcer = enforceRegisteredPolicy as unknown as Enforcer,
): T {
  if (installed.has(router)) return router;
  installed.add(router);

  const surface = router as RouterSurface;
  const originalOn = surface.on;
  if (typeof originalOn === "function") {
    surface.on = function (
      this: unknown,
      method: unknown,
      path: unknown,
      ...handlers: unknown[]
    ) {
      return (originalOn as Registration).apply(this, [
        method,
        path,
        ...withStrictTerminal(handlers, enforce, { method, path }),
      ]);
    };
  }

  for (const method of directMethods) {
    const original = surface[method];
    if (typeof original !== "function") continue;
    surface[method] = function (this: unknown, ...args: unknown[]) {
      // Hono supports using the previously selected base path without repeating it. The API
      // routers in this application always pass an explicit path; leave implicit-path calls
      // untouched rather than infer a route they did not name here.
      if (typeof args[0] !== "string") {
        return (original as Registration).apply(this, args);
      }
      const [path, ...handlers] = args;
      return (original as Registration).apply(this, [
        path,
        ...withStrictTerminal(handlers, enforce, { method, path }),
      ]);
    };
  }

  return router;
}

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren, useMemo, useSyncExternalStore } from "react";

const epochs = new WeakMap<QueryClient, number>();
const listeners = new WeakMap<QueryClient, Set<() => void>>();

export function retireIdentity(queryClient: QueryClient) {
  epochs.set(queryClient, (epochs.get(queryClient) ?? 0) + 1);
  for (const listener of listeners.get(queryClient) ?? []) listener();
}

// Remount consumers so pending mutations keep the retired client in their callbacks.
export function IdentityQueryProvider({
  client,
  children,
}: PropsWithChildren<{ client: QueryClient }>) {
  const epoch = useSyncExternalStore(
    (listener) => {
      let set = listeners.get(client);
      if (!set) {
        set = new Set();
        listeners.set(client, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    },
    () => epochs.get(client) ?? 0,
  );
  const scoped = useMemo(
    () =>
      new Proxy(client, {
        get(target, property) {
          const value = Reflect.get(target, property);
          if (typeof value !== "function") return value;
          if (property === "setQueryData" || property === "setQueriesData") {
            return (...args: unknown[]) =>
              (epochs.get(target) ?? 0) === epoch
                ? value.apply(target, args)
                : undefined;
          }
          return value.bind(target);
        },
      }),
    [client, epoch],
  );
  return (
    <QueryClientProvider key={epoch} client={scoped}>
      {children}
    </QueryClientProvider>
  );
}

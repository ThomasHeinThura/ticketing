import {
  type InfiniteData,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { NotificationInboxPage } from "@/fetchers/notification/get-notifications";
import type { AgentInboxFilter } from "@/lib/routes";
import type { Notification } from "@/types/notification";

type Operation = {
  id?: string;
  read: boolean;
  knownAtStart?: Set<string>;
  unreadIdsAtStart?: Set<string>;
  unreadAtStart?: number;
};
type Store = { operations: Operation[]; listeners: Set<() => void> };
const stores = new WeakMap<QueryClient, Store>();
const empty: Operation[] = [];
function storeFor(client: QueryClient): Store {
  let store = stores.get(client);
  if (!store) {
    store = { operations: empty, listeners: new Set() };
    stores.set(client, store);
  }
  return store;
}
function publish(store: Store, operations: Operation[]) {
  store.operations = operations;
  for (const listener of store.listeners) listener();
}
export function beginNotificationUpdate(
  client: QueryClient,
  operation: Operation,
) {
  const store = storeFor(client);
  if (!operation.id) {
    // Capture the visible state after older pending operations. New rows arriving while this
    // write is pending must not be mistaken for rows covered by mark-all.
    const inboxes = client.getQueriesData<InfiniteData<NotificationInboxPage>>({
      queryKey: ["notifications", "inbox"],
    });
    const known = inboxes.flatMap(
      ([, inbox]) => inbox?.pages.flatMap((page) => page.data) ?? [],
    );
    const projected = inboxes.map(
      ([key, inbox]) =>
        [
          key,
          projectNotifications(
            inbox,
            store.operations,
            key[2] as AgentInboxFilter,
            known,
          ),
        ] as const,
    );
    operation.knownAtStart = new Set(
      projected.flatMap(
        ([, inbox]) =>
          inbox?.pages.flatMap((page) => page.data.map((item) => item.id)) ??
          [],
      ),
    );
    operation.unreadIdsAtStart = new Set(
      projected.flatMap(
        ([, inbox]) =>
          inbox?.pages.flatMap((page) =>
            page.data.filter((item) => !item.isRead).map((item) => item.id),
          ) ?? [],
      ),
    );
    operation.unreadAtStart =
      projected.find(([key]) => key[2] === "all")?.[1]?.pages[0]?.unreadCount ??
      projected.find(([, inbox]) => inbox?.pages[0])?.[1]?.pages[0]
        ?.unreadCount ??
      0;
  }
  publish(store, [...store.operations, operation]);
  return operation;
}
export function endNotificationUpdate(
  client: QueryClient,
  operation: Operation,
) {
  const store = storeFor(client);
  publish(
    store,
    store.operations.filter((item) => item !== operation),
  );
}
/** Keep confirmed writes visible even if a filter is inactive or its refresh fails. */
export function commitNotificationUpdate(
  client: QueryClient,
  operation: Operation,
) {
  const queries = client
    .getQueryCache()
    .findAll({ queryKey: ["notifications", "inbox"] });
  const known = queries.flatMap((query) => {
    const inbox = query.state.data as Inbox | undefined;
    return inbox?.pages.flatMap((page) => page.data) ?? [];
  });
  for (const query of queries) {
    const filter = query.queryKey[2] as AgentInboxFilter;
    client.setQueryData<Inbox>(query.queryKey, (data) =>
      projectNotifications(data, [operation], filter, known),
    );
  }
}
export function useNotificationOperations() {
  const store = storeFor(useQueryClient());
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.operations,
    () => empty,
  );
}

type Inbox = InfiniteData<NotificationInboxPage>;
export function projectNotifications(
  data: Inbox | undefined,
  operations: Operation[],
  filter: AgentInboxFilter,
  known: Notification[],
): Inbox | undefined {
  if (!data || operations.length === 0) return data;
  const rows = new Map(known.map((item) => [item.id, item]));
  for (const page of data.pages)
    for (const item of page.data) rows.set(item.id, item);
  let count = data.pages[0]?.unreadCount ?? 0;
  const states = new Map([...rows].map(([id, item]) => [id, item.isRead]));
  for (const operation of operations) {
    if (!operation.id) {
      const knownAtStart = operation.knownAtStart ?? new Set(states.keys());
      const newlyUnread = [...states].filter(
        ([id, read]) => !knownAtStart.has(id) && !read,
      ).length;
      const initiallyUnread = [...(operation.unreadIdsAtStart ?? [])].filter(
        (id) => states.has(id),
      );
      // With simultaneous unseen row changes the aggregate can be temporarily off; the
      // mandatory settlement reread restores the server's unread count.
      const confirmed =
        initiallyUnread.length > 0 &&
        initiallyUnread.every((id) => states.get(id));
      count = confirmed
        ? count
        : Math.max(newlyUnread, count - (operation.unreadAtStart ?? count));
      for (const id of knownAtStart) if (states.has(id)) states.set(id, true);
    } else {
      const previous = states.get(operation.id);
      if (previous !== undefined && previous !== operation.read) {
        count += operation.read ? -1 : 1;
        states.set(operation.id, operation.read);
      }
    }
  }
  const present = new Set(
    data.pages.flatMap((page) => page.data.map((item) => item.id)),
  );
  const addedUnread =
    filter === "unread"
      ? operations.flatMap((operation) => {
          if (!operation.id || operation.read || present.has(operation.id))
            return [];
          const row = rows.get(operation.id);
          if (!row || states.get(operation.id) !== false) return [];
          present.add(operation.id);
          return [{ ...row, isRead: false }];
        })
      : [];
  return {
    ...data,
    pages: data.pages.map((page, index) => ({
      ...page,
      unreadCount: Math.max(0, count),
      data: [
        ...(index === 0 ? addedUnread : []),
        ...page.data
          .map((item) => ({
            ...item,
            isRead: states.get(item.id) ?? item.isRead,
          }))
          .filter((item) => filter !== "unread" || !item.isRead),
      ],
    })),
  };
}

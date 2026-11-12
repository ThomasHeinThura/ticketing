import { type QueryClient, replaceEqualDeep } from "@tanstack/react-query";

type Fields = Record<string, unknown>;
type Write = { token: symbol; fields: Fields };
const clients = new WeakMap<QueryClient, Map<string, Write[]>>();

export function beginPendingWorkItem(
  client: QueryClient,
  key: string,
  fields: Fields,
) {
  let items = clients.get(client);
  if (!items) {
    items = new Map();
    clients.set(client, items);
  }
  const writes = items.get(key) ?? [];
  const write = { token: Symbol(key), fields };
  writes.push(write);
  items.set(key, writes);
  return write.token;
}

export function endPendingWorkItem(
  client: QueryClient,
  key: string,
  token: symbol,
) {
  const items = clients.get(client);
  const remaining =
    items?.get(key)?.filter((write) => write.token !== token) ?? [];
  if (remaining.length) items?.set(key, remaining);
  else items?.delete(key);
}

export function pendingWorkItemFields(
  client: QueryClient,
  key: string,
): Fields {
  return Object.assign(
    {},
    ...(clients.get(client)?.get(key) ?? []).map((write) => write.fields),
  );
}

/** Merge server reads with the newest still-pending value of each field. */
export function sharePendingDetail(
  client: QueryClient,
  key: string | undefined,
) {
  return (old: unknown, incoming: unknown) => {
    if (!key || !incoming || typeof incoming !== "object")
      return replaceEqualDeep(old, incoming);
    return replaceEqualDeep(old, {
      ...incoming,
      ...pendingWorkItemFields(client, key),
    });
  };
}

/** Infinite work-item lists carry item rows under pages[].items. */
export function sharePendingList(client: QueryClient) {
  return (old: unknown, incoming: unknown) => {
    if (
      !incoming ||
      typeof incoming !== "object" ||
      !("pages" in incoming) ||
      !Array.isArray(incoming.pages)
    )
      return replaceEqualDeep(old, incoming);
    const pages = incoming.pages.map((page: unknown) => {
      if (
        !page ||
        typeof page !== "object" ||
        !("items" in page) ||
        !Array.isArray(page.items)
      )
        return page;
      return {
        ...page,
        items: page.items.map((row: unknown) => {
          if (
            !row ||
            typeof row !== "object" ||
            !("key" in row) ||
            typeof row.key !== "string"
          )
            return row;
          return { ...row, ...pendingWorkItemFields(client, row.key) };
        }),
      };
    });
    return replaceEqualDeep(old, { ...incoming, pages });
  };
}

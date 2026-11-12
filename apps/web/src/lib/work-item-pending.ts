import { type QueryClient, replaceEqualDeep } from "@tanstack/react-query";

type Fields = Record<string, unknown>;
type Write = { token: symbol; fields: Fields };
type ItemWrites = { writes: Write[]; baseline: Fields; version: number };
const clients = new WeakMap<QueryClient, Map<string, ItemWrites>>();

export function beginPendingWorkItem(
  client: QueryClient,
  key: string,
  fields: Fields,
  current: Fields,
  version: number,
) {
  let items = clients.get(client);
  if (!items) {
    items = new Map();
    clients.set(client, items);
  }
  let item = items.get(key);
  if (!item) {
    item = { writes: [], baseline: {}, version };
    items.set(key, item);
  }
  for (const name of Object.keys(fields)) {
    if (!item.writes.some((write) => Object.hasOwn(write.fields, name))) {
      item.baseline[name] = current[name];
    }
  }
  item.version = Math.max(item.version, version);
  const token = Symbol(key);
  item.writes.push({ token, fields });
  return token;
}

/** Only call with a real server read or successful write, never a cache update. */
export function confirmPendingWorkItem(
  client: QueryClient,
  key: string,
  fields: Fields,
  version: number,
) {
  const item = clients.get(client)?.get(key);
  if (!item || version < item.version) return;
  item.version = version;
  for (const name of Object.keys(item.baseline)) {
    if (Object.hasOwn(fields, name)) item.baseline[name] = fields[name];
  }
}

/** Record confirmed rows from a list read without trusting fields rejected by parsing. */
export function confirmPendingWorkItemPage<
  T extends {
    items: Array<{ key: string; version: number; unavailableFields: string[] }>;
  },
>(client: QueryClient, page: T, signal: AbortSignal): T {
  if (!signal.aborted) {
    for (const row of page.items) {
      if (typeof row.key !== "string" || typeof row.version !== "number")
        continue;
      const fields: Fields = { ...row };
      for (const name of row.unavailableFields ?? []) delete fields[name];
      confirmPendingWorkItem(client, row.key, fields, row.version);
    }
  }
  return page;
}

export function confirmedWorkItemFields(
  client: QueryClient,
  key: string,
): Fields {
  return { ...clients.get(client)?.get(key)?.baseline };
}

export function endPendingWorkItem(
  client: QueryClient,
  key: string,
  token: symbol,
) {
  const items = clients.get(client);
  const item = items?.get(key);
  if (!item) return;
  item.writes = item.writes.filter((write) => write.token !== token);
  if (!item.writes.length) items?.delete(key);
}

export function pendingWorkItemFields(
  client: QueryClient,
  key: string,
): Fields {
  return Object.assign(
    {},
    ...(clients.get(client)?.get(key)?.writes ?? []).map(
      (write) => write.fields,
    ),
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

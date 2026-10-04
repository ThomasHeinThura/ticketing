import { createFileRoute } from "@tanstack/react-router";
import { apiFetch } from "@taskdesk/libs";
import { Alert, AlertDescription, Button, Switch } from "@taskdesk/ui";
import { useCallback, useEffect, useState } from "react";
import PageTitle from "@/components/page-title";
import { getApiUrl } from "@/fetchers/get-api-url";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/features",
)({ component: FeatureSettings });

type FeatureFlag = {
  key: string;
  enabled: boolean;
  locked: boolean;
  version: number;
  updatedAt: string | null;
};

function FeatureSettings() {
  const [items, setItems] = useState<FeatureFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await apiFetch(getApiUrl(path), {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", ...init?.headers },
    });
    const body = (await response.json().catch(() => ({}))) as {
      items?: FeatureFlag[];
      key?: string;
      enabled?: boolean;
      locked?: boolean;
      version?: number;
      updatedAt?: string | null;
    };
    if (!response.ok) {
      throw new Error(
        response.status === 409
          ? "This setting changed elsewhere. Reload and retry."
          : "Feature settings are unavailable.",
      );
    }
    return body;
  }, []);

  const refresh = useCallback(async () => {
    const result = await request("instance/features");
    setItems(result.items ?? []);
  }, [request]);

  useEffect(() => {
    void refresh().catch(() => setError("Feature settings are unavailable."));
  }, [refresh]);

  async function save(item: FeatureFlag, enabled: boolean) {
    setPending(item.key);
    setError(null);
    try {
      const updated = await request(
        `instance/features/${encodeURIComponent(item.key)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: item.version,
            enabled,
            locked: item.locked,
          }),
        },
      );
      setItems((current) =>
        current.map((entry) =>
          entry.key === item.key
            ? {
                ...entry,
                enabled: updated.enabled ?? enabled,
                version: updated.version ?? entry.version + 1,
                updatedAt: updated.updatedAt ?? entry.updatedAt,
              }
            : entry,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Feature could not be updated.",
      );
      if (cause instanceof Error && cause.message.includes("changed")) {
        await refresh().catch(() => undefined);
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <PageTitle title="Features" />
      <main className="mx-auto max-w-4xl space-y-6 p-4">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Feature availability</h1>
          <p className="text-muted-foreground">
            Enable features for this instance. These switches do not grant
            access; each feature still applies its own permissions.
          </p>
        </header>
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <section className="divide-y rounded-md border">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <h2 className="font-medium">{item.key}</h2>
                {item.locked ? (
                  <p className="text-sm text-muted-foreground">
                    Locked at the instance level
                  </p>
                ) : null}
              </div>
              <Switch
                checked={item.enabled}
                disabled={item.locked || pending !== null}
                onCheckedChange={(enabled) => void save(item, enabled)}
                aria-label={`Enable ${item.key}`}
              />
            </div>
          ))}
        </section>
        {items.length === 0 ? (
          <p role="status">Loading feature settings…</p>
        ) : null}
        <Button
          variant="outline"
          disabled={pending !== null}
          onClick={() => void refresh()}
        >
          Reload
        </Button>
      </main>
    </>
  );
}

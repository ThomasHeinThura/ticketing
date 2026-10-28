import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CustomerVisibility,
  type OrganisationCustomerVisibility,
  patchOrganisationCustomerVisibility,
} from "@/fetchers/god-mode/organisation-customer-visibility";
import {
  organisationCustomerVisibilityKey,
  useOrganisationCustomerVisibility,
} from "@/hooks/queries/god-mode/use-organisation-customer-visibility";
import { HttpError } from "@/lib/http-error";

export function OrganisationCustomerVisibilityCard({
  organisationId,
}: {
  organisationId: string;
}) {
  const { t } = useTranslation("identityConnections");
  const query = useOrganisationCustomerVisibility(organisationId);

  if (query.isPending) return <Skeleton className="h-48 w-full" />;
  if (query.isError)
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("organisation.customerVisibility.title")}</CardTitle>
          <CardDescription>
            {t("organisation.customerVisibility.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="error">
            <AlertTitle>
              {t("organisation.customerVisibility.unavailable")}
            </AlertTitle>
            <AlertDescription>
              <p>{t("organisation.customerVisibility.loadFailed")}</p>
              <Button
                onClick={() => void query.refetch()}
                type="button"
                variant="outline"
              >
                {t("common.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );

  return (
    <VisibilityForm
      organisationId={organisationId}
      setting={query.data}
      onReload={async () => (await query.refetch()).data}
    />
  );
}

function VisibilityForm({
  organisationId,
  setting,
  onReload,
}: {
  organisationId: string;
  setting: OrganisationCustomerVisibility;
  onReload: () => Promise<OrganisationCustomerVisibility | undefined>;
}) {
  const { t } = useTranslation("identityConnections");
  const queryClient = useQueryClient();
  const [base, setBase] = useState(setting);
  const [visibility, setVisibility] = useState<CustomerVisibility>(
    setting.defaultCustomerVisibility,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({ mutationFn: patchOrganisationCustomerVisibility });
  const busy = save.isPending;
  const changed = visibility !== base.defaultCustomerVisibility;

  async function submit() {
    if (busy || !changed) return;
    setError(null);
    setNotice(null);
    try {
      const saved = await save.mutateAsync({
        organisationId,
        expectedUpdatedAt: base.updatedAt,
        defaultCustomerVisibility: visibility,
      });
      setBase(saved);
      setVisibility(saved.defaultCustomerVisibility);
      queryClient.setQueryData(
        organisationCustomerVisibilityKey(organisationId),
        saved,
      );
      setNotice(t("organisation.customerVisibility.saved"));
    } catch (cause) {
      setError(
        t(
          cause instanceof HttpError && cause.status === 409
            ? "organisation.customerVisibility.conflict"
            : "organisation.customerVisibility.saveFailed",
        ),
      );
    }
  }

  async function reload() {
    const latest = await onReload();
    if (!latest) return;
    setBase(latest);
    setVisibility(latest.defaultCustomerVisibility);
    setError(null);
    setNotice(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("organisation.customerVisibility.title")}</CardTitle>
        <CardDescription>
          {t("organisation.customerVisibility.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="max-w-xl space-y-2">
            <Label htmlFor="organisation-customer-visibility">
              {t("organisation.customerVisibility.defaultLabel")}
            </Label>
            <Select
              disabled={busy}
              onValueChange={(value) => {
                if (value === "private" || value === "organisation") {
                  setVisibility(value);
                  setError(null);
                  setNotice(null);
                }
              }}
              value={visibility}
            >
              <SelectTrigger id="organisation-customer-visibility">
                <SelectValue>
                  {t(`organisation.customerVisibility.${visibility}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  {t("organisation.customerVisibility.private")}
                </SelectItem>
                <SelectItem value="organisation">
                  {t("organisation.customerVisibility.organisation")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <Alert variant="error">
              <AlertDescription>
                <p>{error}</p>
                {save.error instanceof HttpError &&
                save.error.status === 409 ? (
                  <Button
                    onClick={() => void reload()}
                    type="button"
                    variant="outline"
                  >
                    {t("organisation.customerVisibility.reload")}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <Button
            disabled={busy || !changed}
            onClick={() => void submit()}
            type="button"
          >
            {busy
              ? t("organisation.customerVisibility.saving")
              : t("organisation.customerVisibility.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

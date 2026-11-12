import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  SaveButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getS3Draft,
  type S3DraftConfig,
  type S3DraftProbe,
  type S3DraftRequest,
  type S3DraftResponse,
  saveS3Draft,
  testS3Draft,
} from "@/fetchers/god-mode/s3-draft";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { FailureAlert, StepUpFields } from "./step-up-fields";

const emptyConfig: S3DraftConfig = {
  connector: "external",
  endpoint: "",
  publicBaseUrl: "",
  region: "",
  bucket: "",
  keyPrefix: "",
  forcePathStyle: true,
  maxImageUploadBytes: 10485760,
  presignTtlSeconds: 300,
};
type CredentialMode = "keep" | "replace" | "clear";
type NumericField = "maxImageUploadBytes" | "presignTtlSeconds";
const isNumericField = (field: string): field is NumericField =>
  field === "maxImageUploadBytes" || field === "presignTtlSeconds";
// A number field's text only becomes a value once it parses; blank or partial text never turns into 0.
const parseNumber = (raw: string) => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};
// The bundled connector always uses path-style requests.
const effectivePathStyle = (value: S3DraftConfig) =>
  value.connector === "bundled_seaweedfs" || value.forcePathStyle;

export function S3DraftPanel() {
  const { t } = useTranslation("godModeStorage");
  const query = useQuery({
    queryKey: ["god-mode", "s3-draft"],
    queryFn: getS3Draft,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.isPending)
    return (
      <Card>
        <CardContent>{t("draft.loading")}</CardContent>
      </Card>
    );
  if (query.isError || !query.data)
    return (
      <Alert variant="error">
        <AlertTitle>{t("draft.loadFailed")}</AlertTitle>
        <AlertDescription>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  return (
    <S3DraftForm
      initial={query.data}
      reload={async () => {
        const result = await query.refetch();
        if (result.isError || !result.data) throw new Error("reload failed");
        return result.data;
      }}
    />
  );
}

function S3DraftForm({
  initial,
  reload,
}: {
  initial: S3DraftResponse;
  reload: () => Promise<S3DraftResponse>;
}) {
  const { t } = useTranslation("godModeStorage");
  const step = useStepUpAction();
  const [savingDraft, setSavingDraft] = useState(false);
  const [base, setBase] = useState(initial);
  const [config, setConfig] = useState<S3DraftConfig>(
    initial.config ?? emptyConfig,
  );
  const [accessMode, setAccessMode] = useState<CredentialMode>("keep");
  const [secretMode, setSecretMode] = useState<CredentialMode>("keep");
  const [access, setAccess] = useState("");
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState(false);
  const [probe, setProbe] = useState<S3DraftProbe | null>(null);
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  // Raw text of number fields while they are being edited, so a cleared field stays empty.
  const [numberDrafts, setNumberDrafts] = useState<
    Partial<Record<NumericField, string>>
  >({});
  const patch = (change: Partial<S3DraftConfig>) =>
    setConfig((current) => ({ ...current, ...change }));
  const origin = (value: string | undefined) => {
    try {
      return new URL(value ?? "").origin;
    } catch {
      return value ?? "";
    }
  };
  const trimmedAccess = access.trim();
  const trimmedSecret = secret.trim();
  // Mirrors the API's destination rule: a stored key may only go to the destination it was
  // approved for, so any change to these four fields needs both credentials entered afresh.
  const destinationChanged =
    base.config !== null &&
    (config.connector !== base.config.connector ||
      effectivePathStyle(config) !== effectivePathStyle(base.config) ||
      config.bucket !== base.config.bucket ||
      (config.connector === "external" &&
        base.config.connector === "external" &&
        origin(config.endpoint) !== origin(base.config.endpoint)));
  const effectiveAccessMode: CredentialMode = destinationChanged
    ? "replace"
    : accessMode;
  const effectiveSecretMode: CredentialMode = destinationChanged
    ? "replace"
    : secretMode;
  const editingDisabled = step.busy || reloading;
  const credentialsValid =
    (effectiveAccessMode !== "replace" || !!trimmedAccess) &&
    (effectiveSecretMode !== "replace" || !!trimmedSecret);
  /**
   * The config with each number field's text applied when it parses. A blank or unparsable field
   * keeps its last committed value, so a half-cleared field never sends a fragment such as "3".
   */
  function committedConfig(): S3DraftConfig {
    const next = { ...config };
    for (const [field, raw] of Object.entries(numberDrafts) as [
      NumericField,
      string,
    ][]) {
      const parsed = parseNumber(raw);
      if (parsed !== null) next[field] = parsed;
    }
    return next;
  }
  function snapshot(): S3DraftRequest {
    const committed = committedConfig();
    const { endpoint, ...rest } = committed;
    const request: S3DraftRequest = {
      version: base.version,
      config:
        committed.connector === "external"
          ? { ...rest, endpoint }
          : { ...rest, forcePathStyle: true },
    };
    if (effectiveAccessMode !== "keep" || effectiveSecretMode !== "keep")
      request.credentials = {
        ...(effectiveAccessMode === "clear"
          ? { accessKeyId: null }
          : effectiveAccessMode === "replace"
            ? { accessKeyId: trimmedAccess }
            : {}),
        ...(effectiveSecretMode === "clear"
          ? { secretAccessKey: null }
          : effectiveSecretMode === "replace"
            ? { secretAccessKey: trimmedSecret }
            : {}),
      };
    return request;
  }
  async function run(operation: "storage_config_save" | "storage_config_test") {
    if (step.busy) return;
    if (operation === "storage_config_save") setSavingDraft(true);
    setNotice(false);
    setProbe(null);
    try {
      const request = snapshot();
      const result = await step.run<S3DraftResponse | S3DraftProbe>(
        { operation, ...request },
        (token) =>
          operation === "storage_config_save"
            ? saveS3Draft(request, token)
            : testS3Draft(request, token),
      );
      if (result.ok) {
        // Entered credentials never outlive the attempt that used them.
        setAccess("");
        setSecret("");
        if (operation === "storage_config_save") {
          const saved = result.value as S3DraftResponse;
          setBase(saved);
          setConfig(saved.config ?? emptyConfig);
          setNumberDrafts({});
          setAccessMode("keep");
          setSecretMode("keep");
          setNotice(true);
        } else setProbe(result.value as S3DraftProbe);
      }
    } finally {
      if (operation === "storage_config_save") setSavingDraft(false);
    }
  }
  // A version conflict requires an explicit reload; do not send another stale write.
  const conflict = stale || step.failure?.kind === "conflict";
  async function reset() {
    setStale(true);
    setReloading(true);
    setAccess("");
    setSecret("");
    try {
      const fresh = await reload();
      setBase(fresh);
      setConfig(fresh.config ?? emptyConfig);
      setNumberDrafts({});
      setAccessMode("keep");
      setSecretMode("keep");
      setStale(false);
      step.clearFailure();
    } catch {
      setStale(true);
    } finally {
      setReloading(false);
    }
  }
  const fields = [
    "publicBaseUrl",
    "region",
    "bucket",
    "keyPrefix",
    "maxImageUploadBytes",
    "presignTtlSeconds",
  ] as const;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{t("draft.title")}</CardTitle>
          <Badge variant="warning">{t("draft.inactive")}</Badge>
        </div>
        <CardDescription>{t("draft.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="info">
          <AlertDescription>{t("draft.notice")}</AlertDescription>
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="s3-connector">{t("draft.connector")}</Label>
            <Select
              value={config.connector}
              disabled={editingDisabled}
              items={[
                { value: "external", label: t("draft.external") },
                { value: "bundled_seaweedfs", label: t("draft.bundled") },
              ]}
              onValueChange={(value) => {
                if (value === "external" || value === "bundled_seaweedfs")
                  patch({
                    connector: value,
                    ...(value === "bundled_seaweedfs"
                      ? { forcePathStyle: true }
                      : {}),
                  });
              }}
            >
              <SelectTrigger id="s3-connector">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="external">{t("draft.external")}</SelectItem>
                <SelectItem value="bundled_seaweedfs">
                  {t("draft.bundled")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {config.connector === "external" && (
            <div className="space-y-2">
              <Label htmlFor="s3-endpoint">{t("draft.endpoint")}</Label>
              <Input
                id="s3-endpoint"
                disabled={editingDisabled}
                value={config.endpoint ?? ""}
                onChange={(e) => patch({ endpoint: e.currentTarget.value })}
              />
            </div>
          )}
          {fields.map((field) => (
            <div className="space-y-2" key={field}>
              <Label htmlFor={`s3-${field}`}>{t(`draft.${field}`)}</Label>
              <Input
                id={`s3-${field}`}
                disabled={editingDisabled}
                type={isNumericField(field) ? "number" : "text"}
                value={
                  isNumericField(field)
                    ? (numberDrafts[field] ?? String(config[field]))
                    : config[field]
                }
                onChange={(e) => {
                  const raw = e.currentTarget.value;
                  if (!isNumericField(field)) {
                    patch({ [field]: raw });
                    return;
                  }
                  // The text is committed on blur (or used by Save/Test), not while typing,
                  // so clearing "300" one key at a time never leaves "3" behind.
                  setNumberDrafts((current) => ({ ...current, [field]: raw }));
                }}
                onBlur={() => {
                  if (!isNumericField(field)) return;
                  // A value that parses is committed; blank or unparsable text restores the
                  // last committed value. It never becomes 0.
                  const raw = numberDrafts[field];
                  const parsed = raw === undefined ? null : parseNumber(raw);
                  if (parsed !== null) patch({ [field]: parsed });
                  setNumberDrafts(({ [field]: _left, ...rest }) => rest);
                }}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Switch
              id="s3-path-style"
              checked={effectivePathStyle(config)}
              disabled={
                editingDisabled || config.connector === "bundled_seaweedfs"
              }
              onCheckedChange={(checked) => patch({ forcePathStyle: checked })}
            />
            <Label htmlFor="s3-path-style">{t("draft.forcePathStyle")}</Label>
          </div>
        </div>
        {(
          [
            [
              "access",
              effectiveAccessMode,
              setAccessMode,
              access,
              setAccess,
              base.accessKeyIdConfigured,
            ],
            [
              "secret",
              effectiveSecretMode,
              setSecretMode,
              secret,
              setSecret,
              base.secretAccessKeyConfigured,
            ],
          ] as const
        ).map(([name, mode, setMode, value, setValue, configured]) => (
          <div className="space-y-2" key={name}>
            <Label htmlFor={`s3-${name}-mode`}>
              {t(`draft.${name}`)} —{" "}
              {configured ? t("draft.configured") : t("draft.notConfigured")}
            </Label>
            <Select
              value={mode}
              disabled={editingDisabled || destinationChanged}
              items={(["keep", "replace", "clear"] as const).map((value) => ({
                value,
                label: t(`draft.${value}`),
              }))}
              onValueChange={(v) => {
                if (v === "keep" || v === "replace" || v === "clear") {
                  setMode(v);
                  setValue("");
                }
              }}
            >
              <SelectTrigger id={`s3-${name}-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["keep", "replace", "clear"] as const).map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`draft.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === "replace" && (
              <>
                <Label htmlFor={`s3-${name}-value`}>
                  {t(`draft.${name}Value`)}
                </Label>
                <Input
                  id={`s3-${name}-value`}
                  disabled={editingDisabled}
                  type="password"
                  autoComplete="new-password"
                  value={value}
                  onChange={(e) => setValue(e.currentTarget.value)}
                />
              </>
            )}
          </div>
        ))}
        {destinationChanged && (
          <p className="text-sm text-muted-foreground" role="status">
            {t("draft.destinationCredentials")}
          </p>
        )}
        <fieldset disabled={reloading}>
          <StepUpFields action={step} idPrefix="s3-draft-step-up" />
        </fieldset>
        <p className="text-sm text-muted-foreground">{t("draft.verifyEach")}</p>
        {step.failure?.kind === "rate_limited" ? (
          <Alert variant="warning">
            <AlertTitle>{t("draft.operationFailed")}</AlertTitle>
            <AlertDescription>
              {step.failure.retryAfterSeconds
                ? t("draft.rateLimitedWait", {
                    seconds: step.failure.retryAfterSeconds,
                  })
                : t("draft.rateLimited")}
            </AlertDescription>
          </Alert>
        ) : (
          <FailureAlert
            failure={step.failure}
            title={t("draft.operationFailed")}
            onReload={() => void reset()}
          />
        )}
        {notice && (
          <Alert variant="success">
            <AlertTitle>{t("draft.saved")}</AlertTitle>
            <AlertDescription>{t("draft.notice")}</AlertDescription>
          </Alert>
        )}
        {probe && (
          <Alert
            variant={
              probe.status === "verified" && probe.cleanup === "confirmed"
                ? "success"
                : "warning"
            }
          >
            <AlertTitle>{t(`probeStatuses.${probe.status}`)}</AlertTitle>
            <AlertDescription>
              {t("probeOutcome", {
                cleanup: t(`cleanup.${probe.cleanup}`),
                duration: probe.durationMs,
              })}{" "}
              {probe.diagnosticObjectMayRemain
                ? t("probeObjectMayRemain")
                : null}{" "}
              {t("draft.browserUnverified")}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <SaveButton
            type="button"
            disabled={
              !savingDraft && (editingDisabled || conflict || !credentialsValid)
            }
            pending={savingDraft}
            success={notice}
            savedLabel={t("common:actions.saved")}
            onClick={() => void run("storage_config_save")}
          >
            {t("draft.save")}
          </SaveButton>
          <Button
            type="button"
            variant="outline"
            disabled={editingDisabled || conflict || !credentialsValid}
            onClick={() => void run("storage_config_test")}
          >
            {t("draft.test")}
          </Button>
          {conflict && (
            <Button
              type="button"
              variant="outline"
              disabled={reloading}
              onClick={() => void reset()}
            >
              {t("draft.reload")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

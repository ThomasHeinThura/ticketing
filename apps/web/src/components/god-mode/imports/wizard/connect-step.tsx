import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Radio,
  RadioGroup,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import {
  createEngineImportRun,
  createImportSource,
  type EngineRun,
  type ImportPluginId,
  ImportReasonError,
  type ImportSource,
  listImportSources,
} from "@/fetchers/god-mode/imports";
import getProjects from "@/fetchers/project/get-projects";
import { HttpError } from "@/lib/http-error";
import { useIdempotencyKey } from "./use-idempotency-key";
import { MAX_FILE_BYTES, SOURCE_PLUGINS } from "./wizard-model";

const NEW_SOURCE = "new";

/**
 * Step 1: choose the source plugin, connect it (or reuse a saved connection) and bind the run to
 * a project. The credential lives only in this component's state while typing: it is sent once
 * under `credential`, cleared on success and unmount, and never shown again (`hasCredential` only).
 */
export function ConnectStep({
  workspaceId,
  onCreated,
  onCancel,
}: {
  workspaceId: string;
  onCreated: (run: EngineRun) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("godModeImports");
  const [pluginId, setPluginId] = useState<ImportPluginId | "">("");
  const [existingId, setExistingId] = useState(NEW_SOURCE);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [credential, setCredential] = useState("");
  const [fileInfo, setFileInfo] = useState<{ name: string } | null>(null);
  const [fileError, setFileError] = useState(false);
  const credentialRevision = useRef(0);
  const [projectId, setProjectId] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const sourceKey = useIdempotencyKey();
  const runKey = useIdempotencyKey();
  const created = useRef<ImportSource | null>(null);

  useEffect(() => () => setCredential(""), []);

  const plugin = SOURCE_PLUGINS.find((candidate) => candidate.id === pluginId);
  const sources = useQuery({
    queryKey: ["god-mode", "imports", "sources", workspaceId],
    queryFn: () => listImportSources(workspaceId),
    retry: false,
  });
  const projects = useQuery({
    queryKey: ["god-mode", "imports", "projects", workspaceId],
    queryFn: () => getProjects({ workspaceId }),
    retry: false,
  });
  const saved = (sources.data ?? []).filter(
    (source) => source.pluginId === pluginId,
  );
  const reusing = saved.find((source) => source.id === existingId);

  const connect = useMutation({
    mutationFn: async () => {
      if (!plugin) throw new Error("no plugin");
      let source = reusing ?? created.current;
      if (!source) {
        const body = {
          workspaceId,
          pluginId: plugin.id,
          name: name.trim(),
          config: Object.fromEntries(
            plugin.fields
              .filter((field) => field.kind !== "secret")
              .map((field) => [
                field.key,
                field.kind === "file"
                  ? (config[field.key] ?? "")
                  : (config[field.key] ?? "").trim(),
              ])
              .filter(([, value]) => value),
          ),
          ...(credential ? { credential } : {}),
        };
        // The fingerprint never contains the credential, only a revision of it.
        const { credential: _secret, ...visible } = body;
        source = await createImportSource(
          body,
          sourceKey.keyFor(
            JSON.stringify([visible, credentialRevision.current]),
          ),
        );
        sourceKey.reset();
        created.current = source;
        setCredential("");
      }
      const runBody = { projectId, sourceRef: sourceRef.trim() };
      const run = await createEngineImportRun(
        source.id,
        runBody,
        runKey.keyFor(JSON.stringify([source.id, runBody])),
      );
      sourceKey.reset();
      runKey.reset();
      return run;
    },
    onSuccess: (run) => {
      setCredential("");
      onCreated(run);
    },
  });

  const secretField = plugin?.fields.find((field) => field.kind === "secret");
  const configFields =
    plugin?.fields.filter((field) => field.kind !== "secret") ?? [];
  const connectionReady =
    reusing || created.current
      ? true
      : Boolean(
          name.trim() &&
            configFields.every(
              (field) => field.optional || (config[field.key] ?? "").trim(),
            ) &&
            (!secretField || credential),
        );
  const canSubmit =
    Boolean(plugin) &&
    connectionReady &&
    Boolean(projectId) &&
    Boolean(sourceRef.trim()) &&
    !connect.isPending;

  function choosePlugin(next: ImportPluginId) {
    setPluginId(next);
    setExistingId(NEW_SOURCE);
    setConfig({});
    setCredential("");
    setFileInfo(null);
    setFileError(false);
    created.current = null;
    sourceKey.reset();
  }

  function readFile(key: string, file: File | undefined) {
    setFileError(false);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setConfig((current) => ({ ...current, [key]: String(reader.result) }));
      setFileInfo({ name: file.name });
    };
    reader.onerror = () => setFileError(true);
    reader.readAsText(file);
  }

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("wizard.connect.source")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            aria-label={t("wizard.connect.source")}
            value={pluginId}
            onValueChange={(value) => choosePlugin(value as ImportPluginId)}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {SOURCE_PLUGINS.map((candidate) => (
              <Label
                key={candidate.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-accent/50"
              >
                <Radio value={candidate.id} className="mt-0.5" />
                <span className="min-w-0 space-y-1">
                  <span className="block text-sm font-medium">
                    {t(`wizard.plugins.${candidate.labelKey}`)}
                  </span>
                  <span className="block text-muted-foreground text-xs font-normal">
                    {t(`wizard.plugins.${candidate.labelKey}Hint`)}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {plugin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("wizard.connect.connection")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sources.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : saved.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="import-wizard-existing">
                  {t("wizard.connect.savedConnection")}
                </Label>
                <PickerPopover
                  id="import-wizard-existing"
                  value={existingId}
                  onChange={setExistingId}
                  options={[
                    {
                      value: NEW_SOURCE,
                      label: t("wizard.connect.newConnection"),
                    },
                    ...saved.map((source) => ({
                      value: source.id,
                      label: source.name,
                    })),
                  ]}
                />
                {reusing ? (
                  <p className="text-muted-foreground flex items-center gap-2 text-xs">
                    {reusing.hasCredential ? (
                      <Badge variant="outline">
                        {t("wizard.connect.credentialStored")}
                      </Badge>
                    ) : null}
                    {t("wizard.connect.reuseHint")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!reusing ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="import-wizard-name">
                    {t("wizard.connect.name")}
                  </Label>
                  <Input
                    id="import-wizard-name"
                    autoComplete="off"
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                </div>
                {configFields.map((field) =>
                  field.kind === "file" ? (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={`import-wizard-${field.key}`}>
                        {t(`wizard.fields.${field.key}`)}
                      </Label>
                      <Input
                        id={`import-wizard-${field.key}`}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) =>
                          readFile(field.key, event.currentTarget.files?.[0])
                        }
                      />
                      <p className="text-muted-foreground text-xs">
                        {fileInfo
                          ? t("wizard.connect.fileLoaded", {
                              name: fileInfo.name,
                            })
                          : t("wizard.connect.fileHint")}
                      </p>
                      {fileError ? (
                        <p className="text-destructive text-xs">
                          {t("wizard.connect.fileError")}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={`import-wizard-${field.key}`}>
                        {t(`wizard.fields.${field.key}`)}
                      </Label>
                      <Input
                        id={`import-wizard-${field.key}`}
                        autoComplete="off"
                        value={config[field.key] ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setConfig((current) => ({
                            ...current,
                            [field.key]: value,
                          }));
                        }}
                      />
                    </div>
                  ),
                )}
                {secretField ? (
                  <div className="space-y-2">
                    <Label htmlFor="import-wizard-credential">
                      {t("wizard.fields.credential")}
                    </Label>
                    <Input
                      id="import-wizard-credential"
                      type="password"
                      autoComplete="new-password"
                      value={credential}
                      onChange={(event) => {
                        credentialRevision.current += 1;
                        setCredential(event.currentTarget.value);
                      }}
                      aria-describedby="import-wizard-credential-hint"
                    />
                    <p
                      id="import-wizard-credential-hint"
                      className="text-muted-foreground text-xs"
                    >
                      {t("wizard.connect.credentialHint")}
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="import-wizard-target-project">
                {t("wizard.connect.targetProject")}
              </Label>
              {projects.isPending ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <PickerPopover
                  id="import-wizard-target-project"
                  value={projectId || undefined}
                  onChange={setProjectId}
                  placeholder={t("selectProject")}
                  options={(projects.data ?? []).map((project) => ({
                    value: project.id,
                    label: project.name,
                  }))}
                />
              )}
              {projects.isError ? (
                <p className="text-destructive text-xs">
                  {t("projectsLoadError")}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-wizard-source-ref">{t("sourceRef")}</Label>
              <Input
                id="import-wizard-source-ref"
                autoComplete="off"
                maxLength={200}
                value={sourceRef}
                onChange={(event) => setSourceRef(event.currentTarget.value)}
                aria-describedby="import-wizard-source-ref-hint"
              />
              <p
                id="import-wizard-source-ref-hint"
                className="text-muted-foreground text-xs"
              >
                {t("sourceRefHint")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {connect.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("wizard.connect.errorTitle")}</AlertTitle>
          <AlertDescription>
            {connect.error instanceof HttpError && connect.error.status === 409
              ? t("wizard.connect.nameTaken")
              : connect.error instanceof HttpError &&
                  connect.error.status === 403
                ? t("forbiddenDescription")
                : connect.error instanceof ImportReasonError
                  ? t(`wizard.connect.reasons.${connect.error.reason}`, {
                      defaultValue: t("wizard.connect.errorDescription"),
                    })
                  : t("wizard.connect.errorDescription")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={connect.isPending}
        >
          {t("createCancel")}
        </Button>
        <Button disabled={!canSubmit} onClick={() => connect.mutate()}>
          {t("wizard.connect.submit")}
        </Button>
      </div>
    </div>
  );
}

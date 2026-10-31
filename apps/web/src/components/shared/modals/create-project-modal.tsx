import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import type { EngagementKind } from "@/components/project/project-engagement-form";
import icons from "@/constants/project-icons";
import useCreateProject from "@/hooks/mutations/project/use-create-project";
import useCustomerOrganisations from "@/hooks/queries/project/use-customer-organisations";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import generateProjectSlug from "@/lib/generate-project-id";
import { toast } from "@/lib/toast";
import {
  DEFAULT_PROJECT_KIND_VALUES,
  INHERIT_CALENDAR,
  isManagedServiceIncomplete,
  ProjectKindFields,
  type ProjectKindValues,
  useManagedServiceOptions,
} from "./project-kind-fields";

/** PR-13: a project key is 2-8 uppercase ASCII letters (the API refuses anything else). */
const PROJECT_KEY_PATTERN = /^[A-Z]{2,8}$/;

/** The "no customer organisation" choice: the project stays internal (null on the API). */
const INTERNAL_PROJECT = "__internal__";

type CreateProjectModalProps = {
  open: boolean;
  onClose: () => void;
  /** The kind chosen when the modal opens; "Create managed service" presets `managed_service`. */
  defaultKind?: EngagementKind;
};

function initialKindValues(kind: EngagementKind): ProjectKindValues {
  return { ...DEFAULT_PROJECT_KIND_VALUES, kind };
}

function CreateProjectModal({
  open,
  onClose,
  defaultKind = "project",
}: CreateProjectModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("Layout");
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const [organisationId, setOrganisationId] = useState(INTERNAL_PROJECT);
  const [kindValues, setKindValues] = useState<ProjectKindValues>(() =>
    initialKindValues(defaultKind),
  );
  // Each opening starts from the caller's preset (the modal may stay mounted while closed).
  useEffect(() => {
    if (open) setKindValues(initialKindValues(defaultKind));
  }, [open, defaultKind]);
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  // The list route and the binding need the strict project:create capability; callers
  // without it (e.g. members) create internal projects and never see the selector.
  const { canBindProjectOrganisation } = useWorkspacePermission();
  const canBindOrganisation = canBindProjectOrganisation();
  const organisations = useCustomerOrganisations(
    { workspaceId: workspace?.id ?? "" },
    open && canBindOrganisation,
  );
  const customerOrganisations = organisations.data ?? [];
  const selectedOrganisationId = customerOrganisations.some(
    (organisation) => organisation.id === organisationId,
  )
    ? organisationId
    : INTERNAL_PROJECT;
  const isManagedService = kindValues.kind === "managed_service";
  const managedServiceOptions = useManagedServiceOptions(
    workspace?.id ?? "",
    open && isManagedService,
  );
  const managedServiceIncomplete = isManagedServiceIncomplete(
    kindValues,
    managedServiceOptions.workspaceDefaultCalendarId,
    selectedOrganisationId !== INTERNAL_PROJECT,
  );
  const { mutateAsync, isPending } = useCreateProject({
    name,
    slug,
    workspaceId: workspace?.id ?? "",
    icon: selectedIcon,
    organisationId:
      selectedOrganisationId === INTERNAL_PROJECT
        ? null
        : selectedOrganisationId,
    kind: kindValues.kind,
    supportLevel: isManagedService ? kindValues.supportLevel : null,
    serviceCalendarId:
      isManagedService && kindValues.calendarChoice !== INHERIT_CALENDAR
        ? kindValues.calendarChoice
        : null,
  });
  const SelectedIcon =
    icons[selectedIcon as keyof typeof icons] || icons.Layout;
  const filteredIcons = Object.entries(icons).filter(([iconName]) =>
    iconName.toLowerCase().includes(iconSearch.trim().toLowerCase()),
  );
  const navigate = useNavigate();
  const keyInvalid = slug.trim() !== "" && !PROJECT_KEY_PATTERN.test(slug);
  const canSubmit =
    Boolean(name.trim()) &&
    PROJECT_KEY_PATTERN.test(slug) &&
    !managedServiceIncomplete &&
    !isPending;

  const handleClose = () => {
    setName("");
    setSlug("");
    setSelectedIcon("Layout");
    setIconPopoverOpen(false);
    setIconSearch("");
    setOrganisationId(INTERNAL_PROJECT);
    setKindValues(initialKindValues(defaultKind));
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      const { id } = await mutateAsync();
      toast.success("Project created successfully");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });

      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
        params: {
          workspaceId: workspace?.id ?? "",
          projectId: id,
        },
      });

      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // PR-9 and the same-workspace calendar rule come back as 422 text; say what to fix.
      toast.error(
        message.includes("PR-9")
          ? t("common:modals.createProject.managedServiceIncomplete")
          : message.includes("service_calendar_must_belong_to_workspace")
            ? t("common:modals.createProject.calendarInvalid")
            : message || t("common:modals.createProject.errorToast"),
      );
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    setSlug(generateProjectSlug(newName));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader className="px-3 pt-4 pb-1 gap-1.5">
          <DialogTitle className="sr-only">
            {t("common:modals.createProject.title")}
          </DialogTitle>
          <Breadcrumb label={t("common:breadcrumb.label")}>
            <BreadcrumbList className="gap-1 text-xs">
              <BreadcrumbItem className="text-muted-foreground font-medium tracking-wide">
                {workspace?.name?.toUpperCase() ||
                  t("common:modals.createProject.workspaceFallback")}
              </BreadcrumbItem>
              <BreadcrumbSeparator className="[&>svg]:size-3.5" />
              <BreadcrumbItem className="text-foreground font-medium">
                {t("common:modals.createProject.breadcrumbNew")}
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <DialogDescription className="sr-only">
            {t("common:modals.createProject.description")}
          </DialogDescription>
        </DialogHeader>

        {/* The fields scroll inside the panel so the footer stays reachable when the
            managed-service fields make the form taller than a phone screen. */}
        <form onSubmit={handleSubmit} className="contents">
          <DialogPanel className="space-y-4 p-0 pb-4 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-0">
            <div className="space-y-6 px-3 pt-2">
              <Popover
                open={iconPopoverOpen}
                onOpenChange={(open) => {
                  setIconPopoverOpen(open);
                  if (!open) setIconSearch("");
                }}
                modal={true}
              >
                <ActionTooltip
                  label={t("common:modals.createProject.pickIcon")}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="h-8 w-8 p-0"
                      aria-label={t("common:modals.createProject.pickIcon")}
                    >
                      <SelectedIcon className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                </ActionTooltip>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="space-y-2">
                    <Input
                      value={iconSearch}
                      onChange={(e) => setIconSearch(e.target.value)}
                      placeholder={t("common:modals.createProject.searchIcons")}
                      className="h-8 text-xs"
                    />
                    <div className="max-h-[280px] overflow-y-auto pr-1">
                      <div className="grid grid-cols-6 gap-1.5">
                        {filteredIcons.map(([iconName, Icon]) => {
                          const isSelected = selectedIcon === iconName;
                          return (
                            <ActionTooltip key={iconName} label={iconName}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedIcon(iconName);
                                  setIconPopoverOpen(false);
                                  setIconSearch("");
                                }}
                                className={cn(
                                  "h-10 items-center justify-center rounded-md p-0",
                                  isSelected &&
                                    "bg-sidebar-accent text-sidebar-accent-foreground",
                                )}
                                aria-label={iconName}
                              >
                                <Icon className="h-4 w-4" />
                              </Button>
                            </ActionTooltip>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              <Input
                unstyled
                value={name}
                onChange={handleNameChange}
                autoFocus
                placeholder={t("common:modals.createProject.projectName")}
                className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-2xl [&_[data-slot=input]]:leading-tight [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:tracking-tight [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none"
                required
              />
            </div>

            <div className="space-y-3 px-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("common:modals.createProject.keyLabel")}
                  </span>
                  <Input
                    id="project-key"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toUpperCase())}
                    aria-invalid={keyInvalid}
                    aria-describedby={
                      keyInvalid ? "project-key-error" : undefined
                    }
                    placeholder="PRO"
                    maxLength={8}
                    className="w-20 h-8 text-center font-semibold text-sm bg-background border-border rounded-lg transition-colors duration-150"
                    required
                  />
                </div>
                <div className="flex-1 text-xs text-muted-foreground opacity-80">
                  {t("common:modals.createProject.keyHint", {
                    example: slug || "ABC",
                  })}
                </div>
              </div>
              {keyInvalid ? (
                <p
                  id="project-key-error"
                  role="alert"
                  className="text-xs text-destructive"
                  data-testid="project-key-error"
                >
                  {t("common:modals.createProject.keyInvalid")}
                </p>
              ) : null}
            </div>

            <ProjectKindFields
              options={managedServiceOptions}
              values={kindValues}
              onChange={setKindValues}
              hasOrganisation={selectedOrganisationId !== INTERNAL_PROJECT}
              disabled={isPending}
            />

            {canBindOrganisation ? (
              <div
                className="space-y-1.5 px-3"
                data-testid="project-organisation"
              >
                <Label htmlFor="project-organisation">
                  {t("common:modals.createProject.organisationLabel")}
                </Label>
                {organisations.isPending ? (
                  <p
                    role="status"
                    className="text-xs text-muted-foreground"
                    data-testid="project-organisation-loading"
                  >
                    {t("common:modals.createProject.organisationLoading")}
                  </p>
                ) : organisations.isError ? (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-2 text-xs text-destructive"
                    data-testid="project-organisation-error"
                  >
                    <span>
                      {t("common:modals.createProject.organisationError")}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => organisations.refetch()}
                    >
                      {t("common:modals.createProject.organisationRetry")}
                    </Button>
                  </div>
                ) : customerOrganisations.length === 0 ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="project-organisation-empty"
                  >
                    {t("common:modals.createProject.organisationEmpty")}
                  </p>
                ) : (
                  <>
                    <Select
                      value={selectedOrganisationId}
                      onValueChange={(value) => {
                        if (value !== null) setOrganisationId(value);
                      }}
                    >
                      <SelectTrigger id="project-organisation">
                        <SelectValue>
                          {customerOrganisations.find(
                            (organisation) =>
                              organisation.id === selectedOrganisationId,
                          )?.name ??
                            t("common:modals.createProject.organisationNone")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={INTERNAL_PROJECT}>
                          {t("common:modals.createProject.organisationNone")}
                        </SelectItem>
                        {customerOrganisations.map((organisation) => (
                          <SelectItem
                            key={organisation.id}
                            value={organisation.id}
                          >
                            {organisation.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("common:modals.createProject.organisationHint")}
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              onClick={handleClose}
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-accent"
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              size="sm"
              className="bg-primary hover:bg-primary/90  disabled:opacity-50"
            >
              {t("common:modals.createProject.createButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateProjectModal;

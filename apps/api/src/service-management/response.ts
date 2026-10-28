import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const serviceStatusSchema = z.enum([
  "operational",
  "degraded",
  "outage",
]);

export const serviceSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  ownerTeamId: z.string().nullable(),
  ownerTeamName: z.string().nullable(),
  supportLevel: z.string(),
  serviceCalendarId: z.string().nullable(),
  calendarName: z.string().nullable(),
  status: serviceStatusSchema,
  statusNote: z.string().nullable(),
  statusChangedAt: nullableResponseTimestamp,
  incidentCount: z.number().int().min(0),
  openChangeCount: z.number().int().min(0),
  version: z.number().int(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

const serviceRef = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
});

export const serviceDetailSchema = serviceSummarySchema.extend({
  links: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["documentation", "project", "kb_article"]),
      label: z.string().nullable(),
      url: z.string().nullable(),
      projectId: z.string().nullable(),
      projectName: z.string().nullable(),
      kbArticleId: z.string().nullable(),
    }),
  ),
  dependsOn: z.array(serviceRef),
  dependents: z.array(serviceRef),
  releaseChecklist: z.array(
    z.object({ id: z.string(), text: z.string(), position: z.number() }),
  ),
  cycleDetected: z.boolean(),
  deletionBlockers: z.array(z.string()),
});

export const serviceListSchema = z.object({
  data: z.array(serviceSummarySchema),
});

export const serviceImpactSchema = z.object({
  service: serviceRef,
  impacted: z.array(
    z.object({
      serviceId: z.string(),
      name: z.string(),
      status: z.string(),
      depth: z.number().int().min(1),
      viaServiceId: z.string(),
      viaName: z.string(),
    }),
  ),
  customers: z.array(z.object({ id: z.string(), name: z.string() })),
  cycleDetected: z.boolean(),
  cycleServiceIds: z.array(z.string()),
});

const freezeRef = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: responseTimestamp,
  endsAt: responseTimestamp,
});

export const changeViewSchema = z.object({
  workItemKey: z.string(),
  workItemId: z.string(),
  title: z.string(),
  isChange: z.boolean(),
  /** SVC-3: the service the work item references, whatever its type. */
  service: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** The affected services plus their dependents, and the customers they serve. */
  impact: z.object({
    services: z.number().int().min(0),
    customers: z.number().int().min(0),
  }),
  detail: z
    .object({
      risk: z.string().nullable(),
      windowStart: nullableResponseTimestamp,
      windowEnd: nullableResponseTimestamp,
      rollbackPlan: z.string().nullable(),
      release: z.object({ id: z.string(), name: z.string() }).nullable(),
      version: z.number().int(),
      updatedAt: responseTimestamp,
    })
    .nullable(),
  services: z.array(z.object({ id: z.string(), name: z.string() })),
  cabRequired: z.boolean(),
  rollbackPlanPresent: z.boolean(),
  retrospective: z.boolean(),
  freeze: z.object({
    blocked: z.boolean(),
    overridden: z.boolean(),
    freezes: z.array(freezeRef),
    override: z
      .object({
        reason: z.string().nullable(),
        by: z.string().nullable(),
        at: responseTimestamp,
      })
      .nullable(),
  }),
  conflicts: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      serviceIds: z.array(z.string()),
    }),
  ),
});

export const freezeSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  reason: z.string().nullable(),
  startsAt: responseTimestamp,
  endsAt: responseTimestamp,
  cancelledAt: nullableResponseTimestamp,
  version: z.number().int(),
});
export const freezeListSchema = z.object({ data: z.array(freezeSchema) });
export const freezeWriteSchema = z.object({
  freeze: freezeSchema,
  /** Changes whose window overlaps the freeze and that it would now block (not overridden). */
  affectedChanges: z.number().int().min(0),
});
export const overrideReportSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      at: responseTimestamp,
      actorName: z.string().nullable(),
      workItemKey: z.string().nullable(),
      reason: z.string().nullable(),
      freezeNames: z.array(z.string()),
    }),
  ),
});

export const changeCalendarSchema = z.object({
  from: responseTimestamp,
  to: responseTimestamp,
  freezes: z.array(freezeRef.extend({ reason: z.string().nullable() })),
  changes: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      projectId: z.string(),
      projectName: z.string(),
      windowStart: responseTimestamp,
      windowEnd: responseTimestamp,
      risk: z.string().nullable(),
      stateName: z.string(),
      stateGroup: z.string(),
      services: z.array(z.object({ id: z.string(), name: z.string() })),
      retrospective: z.boolean(),
      frozen: z.boolean(),
      overridden: z.boolean(),
      conflict: z.boolean(),
    }),
  ),
  conflicts: z.array(
    z.object({
      changeKeys: z.array(z.string()),
      serviceIds: z.array(z.string()),
    }),
  ),
});

const releaseSummaryShape = {
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  serviceId: z.string(),
  serviceName: z.string(),
  plannedDate: z.string().nullable(),
  status: z.enum(["planned", "in_progress", "released", "cancelled"]),
  publishToPortal: z.boolean(),
  publishedAt: nullableResponseTimestamp,
  version: z.number().int(),
  createdAt: responseTimestamp,
};
export const releaseSummarySchema = z.object({
  ...releaseSummaryShape,
  changeCount: z.number().int().min(0),
  checklistTotal: z.number().int().min(0),
  checklistDone: z.number().int().min(0),
});
export const releaseListSchema = z.object({
  data: z.array(releaseSummarySchema),
});
export const releaseDetailSchema = z.object({
  ...releaseSummaryShape,
  notes: z.string().nullable(),
  /** True when the stored notes are withheld because the caller cannot reach every change. */
  notesRedacted: z.boolean(),
  notesGeneratedAt: nullableResponseTimestamp,
  notesEditedAt: nullableResponseTimestamp,
  notesLocked: z.boolean(),
  changes: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      typeName: z.string(),
      stateName: z.string(),
      risk: z.string().nullable(),
      windowStart: nullableResponseTimestamp,
      windowEnd: nullableResponseTimestamp,
    }),
  ),
  hiddenChangeCount: z.number().int().min(0),
  checklist: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      position: z.number(),
      done: z.boolean(),
    }),
  ),
});

export const catalogueStatusSchema = z.object({
  /** `feature.service_catalogue` for the workspace. */
  enabled: z.boolean(),
  canManageServices: z.boolean(),
  canManageChanges: z.boolean(),
  canManageReleases: z.boolean(),
});

export const okSchema = z.object({ ok: z.literal(true) });
export const versionConflictSchema = z.object({
  message: z.string(),
  currentVersion: z.number().int(),
});

const namedProject = z.object({ id: z.string(), name: z.string() });
export const cabTemplateStatusSchema = z.object({
  applied: z.boolean(),
  workflowId: z.string().nullable(),
  approvedStateTemplateId: z.string().nullable(),
  adoptedProjectIds: z.array(z.string()),
  changeTypeCount: z.number().int(),
});
export const cabTemplateResultSchema = z.object({
  workflowId: z.string(),
  versionNumber: z.number().int(),
  alreadyApplied: z.boolean(),
  approvedStateTemplateId: z.string(),
  changeTypeIds: z.array(z.string()),
  adoptedProjectIds: z.array(z.string()),
  unadoptedProjects: z.array(namedProject),
});
export const cabTemplateConflictSchema = z.object({
  message: z.string(),
  projects: z.array(namedProject).optional(),
});

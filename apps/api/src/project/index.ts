import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import addDocumentLinkCtrl from "./controllers/add-document-link";
import addStakeholderCtrl from "./controllers/add-stakeholder";
import archiveProjectCtrl from "./controllers/archive-project";
import createMilestoneCtrl from "./controllers/create-milestone";
import createPrerequisiteCtrl from "./controllers/create-prerequisite";
import createProjectCtrl, {
  ProjectSlugTakenError,
} from "./controllers/create-project";
import deleteDocumentLinkCtrl from "./controllers/delete-document-link";
import deleteMilestoneCtrl from "./controllers/delete-milestone";
import deletePrerequisiteCtrl from "./controllers/delete-prerequisite";
import deleteProjectCtrl from "./controllers/delete-project";
import getProjectCtrl from "./controllers/get-project";
import getProjectsCtrl from "./controllers/get-projects";
import listDocumentLinksCtrl from "./controllers/list-document-links";
import listMilestonesCtrl from "./controllers/list-milestones";
import listPrerequisitesCtrl from "./controllers/list-prerequisites";
import listStakeholdersCtrl from "./controllers/list-stakeholders";
import reorderProjectsCtrl from "./controllers/reorder-projects";
import standDownStakeholderCtrl from "./controllers/stand-down-stakeholder";
import unarchiveProjectCtrl from "./controllers/unarchive-project";
import updateMilestoneCtrl from "./controllers/update-milestone";
import updatePrerequisiteCtrl from "./controllers/update-prerequisite";
import updateProjectCtrl from "./controllers/update-project";
import updateStakeholderCtrl from "./controllers/update-stakeholder";
import {
  documentLinkSchema,
  milestoneSchema,
  prerequisiteSchema,
  projectListSchema,
  projectSchema,
  stakeholderSchema,
} from "./response";
import {
  createDocumentLinkBody,
  createMilestoneBody,
  createPrerequisiteBody,
  createProjectBody,
  createStakeholderBody,
  documentLinkParam,
  listProjectsQuery,
  milestoneParam,
  prerequisiteParam,
  projectParam,
  reorderProjectsBody,
  stakeholderParam,
  updateMilestoneBody,
  updatePrerequisiteBody,
  updateProjectBody,
  updateStakeholderBody,
  workspaceIdQuery,
} from "./schema";

const listProjectsRoute = createRoute({
  method: "get",
  operationId: "listProjects",
  path: "/",
  tags: ["Projects"],
  summary: "List projects",
  description:
    "List a workspace's projects in sidebar order, each with rollup task statistics. Archived projects are excluded unless includeArchived is set.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: listProjectsQuery },
  responses: {
    200: jsonResponse("List of projects", projectListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const createProjectRoute = createRoute({
  method: "post",
  operationId: "createProject",
  path: "/",
  tags: ["Projects"],
  summary: "Create project",
  description:
    "Create a project in a workspace. The slug becomes the prefix of its task identifiers.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ project: ["create"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createProjectBody } },
    },
  },
  responses: {
    200: jsonResponse("The created project", projectSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing project:create permission",
    ),
    409: errorResponse("That project slug is already taken"),
  },
});

const getProjectRoute = createRoute({
  method: "get",
  operationId: "getProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Get project",
  description: "Get a single project by ID.",
  middleware: [workspaceAccess.fromProject()] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Project details", projectSchema),
    // #290: an out-of-reach project now gets this identical 400 too, not the 403
    // `workspaceAccess.fromProject` used to answer for it (#202's own precedent).
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    404: errorResponse("Project not found"),
  },
});

const reorderProjectsRoute = createRoute({
  method: "put",
  operationId: "reorderProjects",
  path: "/reorder",
  tags: ["Projects"],
  summary: "Reorder projects",
  description:
    "Set the sidebar order of a workspace's projects. The given positions express relative order only -- the workspace is renumbered to 0..n-1.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    query: workspaceIdQuery,
    body: {
      required: true,
      content: { "application/json": { schema: reorderProjectsBody } },
    },
  },
  responses: {
    // Reorder returns the plain project rows, without the list route's
    // rollup statistics.
    200: jsonResponse("The reordered projects", z.array(projectSchema)),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const updateProjectRoute = createRoute({
  method: "put",
  operationId: "updateProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Update project",
  description:
    "Replace a project's name, icon, slug, and description; optionally configure its default comment visibility.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated project", projectSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse(
      "Project doesn't exist or doesn't belong to the specified workspace",
    ),
    409: errorResponse("That project slug is already taken"),
  },
});

const deleteProjectRoute = createRoute({
  method: "delete",
  operationId: "deleteProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Delete project",
  description:
    "Soft-delete a project: it disappears from ordinary use immediately and, along " +
    "with its work items, comments, attachments and time entries, is eligible for " +
    "purge 30 days later, once the purge job (#198) exists. Archive it instead if " +
    "you just want it out of the way without starting that clock.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["delete"] }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The deleted project", projectSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing project:delete permission"),
    404: errorResponse("Project not found"),
  },
});

const archiveProjectRoute = createRoute({
  method: "put",
  operationId: "archiveProject",
  path: "/{id}/archive",
  tags: ["Projects"],
  summary: "Archive project",
  description:
    "Hide a project from the default list without deleting it. Reversible with unarchive.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The archived project", projectSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse(
      "Project doesn't exist or doesn't belong to the specified workspace",
    ),
  },
});

const unarchiveProjectRoute = createRoute({
  method: "put",
  operationId: "unarchiveProject",
  path: "/{id}/unarchive",
  tags: ["Projects"],
  summary: "Unarchive project",
  description: "Return an archived project to the default list.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The restored project", projectSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse(
      "Project doesn't exist or doesn't belong to the specified workspace",
    ),
  },
});

// ── Issue #25's bounded slice: milestones, prerequisites, stakeholders, document ───────
// links (`docs/03-features/projects-and-engagements.md` § API). Project members,
// ownership (parent_id/owner_team_id) and health are NOT part of this slice -- see the
// PR description for the three tracked gaps that block them. Every route below shares
// `project:update`'s enforcement (`requireWorkspacePermission({ project: ["update"] })`)
// -- the spec's own permission table: "Manage stakeholders, milestones, prerequisites,
// document links; set health | project:update" -- and `workspaceAccess.fromProject()`
// against the same `{id}` path param the parent project routes already use.

const listMilestonesRoute = createRoute({
  method: "get",
  operationId: "listMilestones",
  path: "/{id}/milestones",
  tags: ["Projects"],
  summary: "List a project's milestones",
  description: "Name, date, reached -- ordered by date.",
  middleware: [workspaceAccess.fromProject()] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The project's milestones", z.array(milestoneSchema)),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    404: errorResponse("Project not found"),
  },
});

const createMilestoneRoute = createRoute({
  method: "post",
  operationId: "createMilestone",
  path: "/{id}/milestones",
  tags: ["Projects"],
  summary: "Create a milestone",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: createMilestoneBody } },
    },
  },
  responses: {
    200: jsonResponse("The created milestone", milestoneSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project not found"),
  },
});

const updateMilestoneRoute = createRoute({
  method: "patch",
  operationId: "updateMilestone",
  path: "/{id}/milestones/{milestoneId}",
  tags: ["Projects"],
  summary: "Update a milestone",
  description:
    "Partial update. `reached: true` marks it reached now; `reached: false` clears it.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: milestoneParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateMilestoneBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated milestone", milestoneSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or milestone not found"),
  },
});

const deleteMilestoneRoute = createRoute({
  method: "delete",
  operationId: "deleteMilestone",
  path: "/{id}/milestones/{milestoneId}",
  tags: ["Projects"],
  summary: "Delete a milestone",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: milestoneParam },
  responses: {
    200: jsonResponse("The deleted milestone", milestoneSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or milestone not found"),
  },
});

const listPrerequisitesRoute = createRoute({
  method: "get",
  operationId: "listPrerequisites",
  path: "/{id}/prerequisites",
  tags: ["Projects"],
  summary: "List a project's prerequisites",
  middleware: [workspaceAccess.fromProject()] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse(
      "The project's prerequisites",
      z.array(prerequisiteSchema),
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    404: errorResponse("Project not found"),
  },
});

const createPrerequisiteRoute = createRoute({
  method: "post",
  operationId: "createPrerequisite",
  path: "/{id}/prerequisites",
  tags: ["Projects"],
  summary: "Create a prerequisite",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: createPrerequisiteBody } },
    },
  },
  responses: {
    200: jsonResponse("The created prerequisite", prerequisiteSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project not found"),
  },
});

const updatePrerequisiteRoute = createRoute({
  method: "patch",
  operationId: "updatePrerequisite",
  path: "/{id}/prerequisites/{prerequisiteId}",
  tags: ["Projects"],
  summary: "Update a prerequisite",
  description:
    "Partial update. `completed: true` ticks it off now; `completed: false` clears it. " +
    "`PR-11`: there is no portal route onto this table, so ticking off is staff-only " +
    "structurally, not by an application-level check here.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: prerequisiteParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePrerequisiteBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated prerequisite", prerequisiteSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or prerequisite not found"),
  },
});

const deletePrerequisiteRoute = createRoute({
  method: "delete",
  operationId: "deletePrerequisite",
  path: "/{id}/prerequisites/{prerequisiteId}",
  tags: ["Projects"],
  summary: "Delete a prerequisite",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: prerequisiteParam },
  responses: {
    200: jsonResponse("The deleted prerequisite", prerequisiteSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or prerequisite not found"),
  },
});

const listStakeholdersRoute = createRoute({
  method: "get",
  operationId: "listStakeholders",
  path: "/{id}/stakeholders",
  tags: ["Projects"],
  summary: "List a project's stakeholders",
  description: "Ordered by escalation order.",
  middleware: [workspaceAccess.fromProject()] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The project's stakeholders", z.array(stakeholderSchema)),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    404: errorResponse("Project not found"),
  },
});

const addStakeholderRoute = createRoute({
  method: "post",
  operationId: "addStakeholder",
  path: "/{id}/stakeholders",
  tags: ["Projects"],
  summary: "Add a stakeholder",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: createStakeholderBody } },
    },
  },
  responses: {
    200: jsonResponse("The added stakeholder", stakeholderSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or person not found"),
  },
});

const updateStakeholderRoute = createRoute({
  method: "patch",
  operationId: "updateStakeholder",
  path: "/{id}/stakeholders/{stakeholderId}",
  tags: ["Projects"],
  summary: "Update a stakeholder",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: stakeholderParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateStakeholderBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated stakeholder", stakeholderSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or stakeholder not found"),
  },
});

const standDownStakeholderRoute = createRoute({
  method: "post",
  operationId: "standDownStakeholder",
  path: "/{id}/stakeholders/{stakeholderId}/stand-down",
  tags: ["Projects"],
  summary: "Stand down a stakeholder",
  description:
    "PR-12: stood down, never deleted -- removed from counts and pickers, keeps history.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: stakeholderParam },
  responses: {
    200: jsonResponse("The stood-down stakeholder", stakeholderSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or stakeholder not found"),
  },
});

const listDocumentLinksRoute = createRoute({
  method: "get",
  operationId: "listDocumentLinks",
  path: "/{id}/document-links",
  tags: ["Projects"],
  summary: "List a project's document links",
  middleware: [workspaceAccess.fromProject()] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse(
      "The project's document links",
      z.array(documentLinkSchema),
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    404: errorResponse("Project not found"),
  },
});

const addDocumentLinkRoute = createRoute({
  method: "post",
  operationId: "addDocumentLink",
  path: "/{id}/document-links",
  tags: ["Projects"],
  summary: "Add a document link",
  description:
    "A link, never a copy. No PATCH: editing url or title is remove-then-re-add.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: createDocumentLinkBody } },
    },
  },
  responses: {
    200: jsonResponse("The added document link", documentLinkSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project not found"),
  },
});

const deleteDocumentLinkRoute = createRoute({
  method: "delete",
  operationId: "deleteDocumentLink",
  path: "/{id}/document-links/{documentLinkId}",
  tags: ["Projects"],
  summary: "Delete a document link",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: documentLinkParam },
  responses: {
    200: jsonResponse("The deleted document link", documentLinkSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project or document link not found"),
  },
});

const project = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listProjectsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const { includeArchived } = c.req.valid("query");
    const projects = await getProjectsCtrl(
      workspaceId,
      includeArchived === "true",
    );
    return c.json(projects, 200);
  })
  .openapi(createProjectRoute, async (c) => {
    const { name, icon, slug } = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    try {
      const newProject = await createProjectCtrl(workspaceId, name, icon, slug);
      return c.json(newProject, 200);
    } catch (error) {
      if (error instanceof ProjectSlugTakenError) {
        throw new HTTPException(409, {
          message: "That project slug is already taken",
        });
      }
      throw error;
    }
  })
  .openapi(getProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const projectData = await getProjectCtrl(id, workspaceId);
    return c.json(projectData, 200);
  })
  .openapi(reorderProjectsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const { projects } = c.req.valid("json");
    const reordered = await reorderProjectsCtrl(workspaceId, projects);
    return c.json(reordered, 200);
  })
  .openapi(updateProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { name, icon, slug, description, defaultCommentVisibility } =
      c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    if (defaultCommentVisibility !== undefined) {
      const userId = c.get("userId");
      if (!workspaceId || !userId) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }

      // API-key scopes intersect the caller's current capability, just as the
      // route-level project:update scope does above. A key that was not granted
      // this setting action cannot acquire it from its owner's role.
      const apiKey = c.get("apiKey") as
        | { permissions?: Record<string, string[]> | null }
        | undefined;
      if (apiKey && !apiKey.permissions?.project?.includes("manage_settings")) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }

      await assertCallerHasCapability(
        workspaceId,
        userId,
        "project:manage_settings",
      );
    }
    try {
      const updatedProject = await updateProjectCtrl(
        id,
        name,
        icon,
        slug,
        description,
        workspaceId,
        defaultCommentVisibility,
      );
      return c.json(updatedProject, 200);
    } catch (error) {
      if (error instanceof ProjectSlugTakenError) {
        throw new HTTPException(409, {
          message: "That project slug is already taken",
        });
      }
      throw error;
    }
  })
  .openapi(deleteProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const deletedProject = await deleteProjectCtrl(id, workspaceId);
    return c.json(deletedProject, 200);
  })
  .openapi(archiveProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const archivedProject = await archiveProjectCtrl(id, workspaceId);
    return c.json(archivedProject, 200);
  })
  .openapi(unarchiveProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const unarchivedProject = await unarchiveProjectCtrl(id, workspaceId);
    return c.json(unarchivedProject, 200);
  })
  .openapi(listMilestonesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const milestones = await listMilestonesCtrl(id, workspaceId);
    return c.json(milestones, 200);
  })
  .openapi(createMilestoneRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const created = await createMilestoneCtrl(id, workspaceId, body);
    return c.json(created, 200);
  })
  .openapi(updateMilestoneRoute, async (c) => {
    const { id, milestoneId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const updated = await updateMilestoneCtrl(
      id,
      milestoneId,
      workspaceId,
      body,
    );
    return c.json(updated, 200);
  })
  .openapi(deleteMilestoneRoute, async (c) => {
    const { id, milestoneId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const deleted = await deleteMilestoneCtrl(id, milestoneId, workspaceId);
    return c.json(deleted, 200);
  })
  .openapi(listPrerequisitesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const prerequisites = await listPrerequisitesCtrl(id, workspaceId);
    return c.json(prerequisites, 200);
  })
  .openapi(createPrerequisiteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const created = await createPrerequisiteCtrl(id, workspaceId, body);
    return c.json(created, 200);
  })
  .openapi(updatePrerequisiteRoute, async (c) => {
    const { id, prerequisiteId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const updated = await updatePrerequisiteCtrl(
      id,
      prerequisiteId,
      workspaceId,
      body,
    );
    return c.json(updated, 200);
  })
  .openapi(deletePrerequisiteRoute, async (c) => {
    const { id, prerequisiteId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const deleted = await deletePrerequisiteCtrl(
      id,
      prerequisiteId,
      workspaceId,
    );
    return c.json(deleted, 200);
  })
  .openapi(listStakeholdersRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const stakeholders = await listStakeholdersCtrl(id, workspaceId);
    return c.json(stakeholders, 200);
  })
  .openapi(addStakeholderRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const created = await addStakeholderCtrl(id, workspaceId, body);
    return c.json(created, 200);
  })
  .openapi(updateStakeholderRoute, async (c) => {
    const { id, stakeholderId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const updated = await updateStakeholderCtrl(
      id,
      stakeholderId,
      workspaceId,
      body,
    );
    return c.json(updated, 200);
  })
  .openapi(standDownStakeholderRoute, async (c) => {
    const { id, stakeholderId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const updated = await standDownStakeholderCtrl(
      id,
      stakeholderId,
      workspaceId,
    );
    return c.json(updated, 200);
  })
  .openapi(listDocumentLinksRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const documentLinks = await listDocumentLinksCtrl(id, workspaceId);
    return c.json(documentLinks, 200);
  })
  .openapi(addDocumentLinkRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const created = await addDocumentLinkCtrl(id, workspaceId, body);
    return c.json(created, 200);
  })
  .openapi(deleteDocumentLinkRoute, async (c) => {
    const { id, documentLinkId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const deleted = await deleteDocumentLinkCtrl(
      id,
      documentLinkId,
      workspaceId,
    );
    return c.json(deleted, 200);
  });

export default project;

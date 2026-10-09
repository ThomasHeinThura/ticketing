import { and, count, countDistinct, eq, gt, like, ne, or } from "drizzle-orm";
import db from "../database";
import {
  invitationTable,
  personTable,
  userTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export const listWorkspaceSlugNeighboursQuery = (base: string) =>
  db
    .select({ slug: workspaceTable.slug })
    .from(workspaceTable)
    .where(
      or(eq(workspaceTable.slug, base), like(workspaceTable.slug, `${base}-%`)),
    );
export const getWorkspaceQuery = (id: string) =>
  db.select().from(workspaceTable).where(eq(workspaceTable.id, id));
export const findWorkspaceSlugConflictQuery = (
  slug: string,
  workspaceId: string,
) =>
  db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(
      and(eq(workspaceTable.slug, slug), ne(workspaceTable.id, workspaceId)),
    )
    .limit(1);
export const getWorkspaceDetailQuery = (workspaceId: string) =>
  db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
      logo: workspaceTable.logo,
      description: workspaceTable.description,
      createdAt: workspaceTable.createdAt,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
export const listUserWorkspacesQuery = (userId: string) =>
  db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
      logo: workspaceTable.logo,
      description: workspaceTable.description,
      createdAt: workspaceTable.createdAt,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceUserTable.workspaceId, workspaceTable.id),
    )
    .where(eq(workspaceUserTable.userId, userId));
export const listWorkspaceInvitationsQuery = (workspaceId: string) =>
  db
    .select({
      id: invitationTable.id,
      email: invitationTable.email,
      role: invitationTable.role,
      status: invitationTable.status,
      expiresAt: invitationTable.expiresAt,
      createdAt: invitationTable.createdAt,
      inviterId: invitationTable.inviterId,
    })
    .from(invitationTable)
    .where(
      and(
        eq(invitationTable.workspaceId, workspaceId),
        eq(invitationTable.status, "pending"),
      ),
    );
export const listWorkspaceMembersQuery = (workspaceId: string) =>
  db
    .select({
      id: userTable.id,
      personId: personTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .leftJoin(personTable, eq(personTable.userId, userTable.id))
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
export const getWorkspaceRoleQuery = (
  executor: Executor,
  workspaceId: string,
  role: string,
) =>
  executor
    .select({ role: workspaceRoleTable.role })
    .from(workspaceRoleTable)
    .where(
      and(
        eq(workspaceRoleTable.workspaceId, workspaceId),
        eq(workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
export const getUserProfileQuery = (executor: Executor, userId: string) =>
  executor
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
export const getWorkspaceMemberQuery = (
  executor: Executor,
  workspaceId: string,
  userId: string,
) =>
  executor
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
export const countWorkspaceRolesQuery = (
  executor: Executor,
  workspaceId: string,
) =>
  executor
    .select({ value: count() })
    .from(workspaceRoleTable)
    .where(eq(workspaceRoleTable.workspaceId, workspaceId));
export const findWorkspaceRoleByNameQuery = (
  executor: Executor,
  workspaceId: string,
  role: string,
) =>
  executor
    .select({ id: workspaceRoleTable.id })
    .from(workspaceRoleTable)
    .where(
      and(
        eq(workspaceRoleTable.workspaceId, workspaceId),
        eq(workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
export const getWorkspaceRoleByIdQuery = (
  executor: Executor,
  workspaceId: string,
  id: string,
) =>
  executor
    .select()
    .from(workspaceRoleTable)
    .where(
      and(
        eq(workspaceRoleTable.workspaceId, workspaceId),
        eq(workspaceRoleTable.id, id),
      ),
    )
    .limit(1);
export const listWorkspaceMemberRoleValuesQuery = (
  executor: Executor,
  workspaceId: string,
) =>
  executor
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
export const getWorkspaceRoleRecordQuery = (
  executor: Executor,
  workspaceId: string,
  role: string,
) =>
  executor
    .select()
    .from(workspaceRoleTable)
    .where(
      and(
        eq(workspaceRoleTable.workspaceId, workspaceId),
        eq(workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
export const findWorkspaceMemberByEmailQuery = (
  executor: Executor,
  workspaceId: string,
  email: string,
) =>
  executor
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(userTable.email, email),
      ),
    )
    .limit(1);
export const findPendingInvitationQuery = (
  executor: Executor,
  workspaceId: string,
  email: string,
  now: Date,
) =>
  executor
    .select({ id: invitationTable.id })
    .from(invitationTable)
    .where(
      and(
        eq(invitationTable.workspaceId, workspaceId),
        eq(invitationTable.email, email),
        eq(invitationTable.status, "pending"),
        gt(invitationTable.expiresAt, now),
      ),
    )
    .limit(1);
export const countPendingInvitationsQuery = (
  executor: Executor,
  workspaceId: string,
) =>
  executor
    .select({ value: count() })
    .from(invitationTable)
    .where(
      and(
        eq(invitationTable.workspaceId, workspaceId),
        eq(invitationTable.status, "pending"),
      ),
    );
export const getWorkspaceNameQuery = (workspaceId: string) =>
  db
    .select({ name: workspaceTable.name })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
export const getInviterQuery = (userId: string) =>
  db
    .select({ name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
export const listWorkspaceRolesQuery = (workspaceId: string) =>
  db
    .select()
    .from(workspaceRoleTable)
    .where(eq(workspaceRoleTable.workspaceId, workspaceId));
export const listWorkspaceMemberRolesQuery = (
  executor: Executor,
  workspaceId: string,
  userId: string,
) =>
  executor
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    );
export const listWorkspaceRolesByRoleQuery = (
  executor: Executor,
  workspaceId: string,
  role: string,
) =>
  executor
    .select({ permission: workspaceRoleTable.permission })
    .from(workspaceRoleTable)
    .where(
      and(
        eq(workspaceRoleTable.workspaceId, workspaceId),
        eq(workspaceRoleTable.role, role),
      ),
    );
export const countDistinctWorkspaceOwnersQuery = (
  executor: Executor,
  workspaceId: string,
) =>
  executor
    .select({ owners: countDistinct(workspaceUserTable.userId) })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.role, "owner"),
      ),
    );

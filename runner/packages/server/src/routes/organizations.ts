/**
 * Organizations routes
 * Translates: crates/server/src/routes/organizations.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as crypto from 'node:crypto';

// Types
export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  userId: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface Invitation {
  id: string;
  token: string;
  organizationId: string;
  email: string;
  role: 'admin' | 'member';
  invitedBy: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface CreateOrganizationBody {
  name: string;
  description?: string;
}

export interface UpdateOrganizationBody {
  name?: string;
  description?: string;
  avatarUrl?: string;
}

export interface CreateInvitationBody {
  email: string;
  role: 'admin' | 'member';
}

export interface UpdateMemberRoleBody {
  role: 'admin' | 'member';
}

// In-memory stores
const organizations = new Map<string, Organization>();
const members = new Map<string, OrganizationMember[]>(); // org_id -> members
const invitations = new Map<string, Invitation>();
const invitationsByToken = new Map<string, Invitation>();

// Mock current user ID (would come from auth middleware)
const MOCK_USER_ID = 'current-user-id';

export const organizationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/organizations - List all organizations
  fastify.get('/organizations', async () => {
    // Return organizations the current user is a member of
    const userOrgs: Organization[] = [];

    for (const [orgId, orgMembers] of members) {
      if (orgMembers.some(m => m.userId === MOCK_USER_ID)) {
        const org = organizations.get(orgId);
        if (org) userOrgs.push(org);
      }
    }

    return {
      organizations: userOrgs,
      total: userOrgs.length
    };
  });

  // POST /api/organizations - Create organization
  fastify.post<{ Body: CreateOrganizationBody }>('/organizations', async (request, reply) => {
    const { name, description } = request.body;

    const id = crypto.randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const now = new Date().toISOString();

    const org: Organization = {
      id,
      name,
      slug,
      description,
      ownerId: MOCK_USER_ID,
      createdAt: now,
      updatedAt: now
    };

    organizations.set(id, org);

    // Add creator as owner
    members.set(id, [{
      userId: MOCK_USER_ID,
      organizationId: id,
      role: 'owner',
      joinedAt: now
    }]);

    fastify.log.info(`Organization created: ${id} (${name})`);

    return reply.status(201).send(org);
  });

  // GET /api/organizations/:id - Get organization
  fastify.get<{ Params: { id: string } }>('/organizations/:id', async (request, reply) => {
    const { id } = request.params;
    const org = organizations.get(id);

    if (!org) {
      return reply.status(404).send({ error: 'Organization not found' });
    }

    // Check membership
    const orgMembers = members.get(id) ?? [];
    if (!orgMembers.some(m => m.userId === MOCK_USER_ID)) {
      return reply.status(403).send({ error: 'Not a member of this organization' });
    }

    return org;
  });

  // PATCH /api/organizations/:id - Update organization
  fastify.patch<{ Params: { id: string }; Body: UpdateOrganizationBody }>(
    '/organizations/:id',
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      const org = organizations.get(id);
      if (!org) {
        return reply.status(404).send({ error: 'Organization not found' });
      }

      // Check admin permission
      const orgMembers = members.get(id) ?? [];
      const member = orgMembers.find(m => m.userId === MOCK_USER_ID);
      if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin permission required' });
      }

      const updatedOrg: Organization = {
        ...org,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      organizations.set(id, updatedOrg);

      return updatedOrg;
    }
  );

  // DELETE /api/organizations/:id - Delete organization
  fastify.delete<{ Params: { id: string } }>('/organizations/:id', async (request, reply) => {
    const { id } = request.params;
    const org = organizations.get(id);

    if (!org) {
      return reply.status(404).send({ error: 'Organization not found' });
    }

    // Only owner can delete
    if (org.ownerId !== MOCK_USER_ID) {
      return reply.status(403).send({ error: 'Only owner can delete organization' });
    }

    organizations.delete(id);
    members.delete(id);

    // Delete all invitations
    for (const [token, inv] of invitationsByToken) {
      if (inv.organizationId === id) {
        invitationsByToken.delete(token);
        invitations.delete(inv.id);
      }
    }

    fastify.log.info(`Organization deleted: ${id}`);

    return reply.status(204).send();
  });

  // POST /api/organizations/:orgId/invitations - Create invitation
  fastify.post<{ Params: { orgId: string }; Body: CreateInvitationBody }>(
    '/organizations/:orgId/invitations',
    async (request, reply) => {
      const { orgId } = request.params;
      const { email, role } = request.body;

      const org = organizations.get(orgId);
      if (!org) {
        return reply.status(404).send({ error: 'Organization not found' });
      }

      // Check admin permission
      const orgMembers = members.get(orgId) ?? [];
      const member = orgMembers.find(m => m.userId === MOCK_USER_ID);
      if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin permission required' });
      }

      const id = crypto.randomUUID();
      const token = crypto.randomBytes(32).toString('hex');
      const now = new Date();

      const invitation: Invitation = {
        id,
        token,
        organizationId: orgId,
        email,
        role,
        invitedBy: MOCK_USER_ID,
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      };

      invitations.set(id, invitation);
      invitationsByToken.set(token, invitation);

      fastify.log.info(`Invitation created for ${email} to org ${orgId}`);

      return reply.status(201).send({
        id,
        token,
        email,
        role,
        inviteUrl: `/invite/${token}`,
        expiresAt: invitation.expiresAt
      });
    }
  );

  // GET /api/organizations/:orgId/invitations - List invitations
  fastify.get<{ Params: { orgId: string } }>(
    '/organizations/:orgId/invitations',
    async (request, reply) => {
      const { orgId } = request.params;

      if (!organizations.has(orgId)) {
        return reply.status(404).send({ error: 'Organization not found' });
      }

      const orgInvitations = Array.from(invitations.values())
        .filter(inv => inv.organizationId === orgId);

      return {
        invitations: orgInvitations,
        total: orgInvitations.length
      };
    }
  );

  // POST /api/organizations/:orgId/invitations/revoke - Revoke invitation
  fastify.post<{ Params: { orgId: string }; Body: { invitationId: string } }>(
    '/organizations/:orgId/invitations/revoke',
    async (request, reply) => {
      const { orgId } = request.params;
      const { invitationId } = request.body;

      const invitation = invitations.get(invitationId);
      if (!invitation || invitation.organizationId !== orgId) {
        return reply.status(404).send({ error: 'Invitation not found' });
      }

      invitation.status = 'revoked';
      invitations.set(invitationId, invitation);

      return { success: true, invitationId };
    }
  );

  // GET /api/invitations/:token - Get invitation details
  fastify.get<{ Params: { token: string } }>('/invitations/:token', async (request, reply) => {
    const { token } = request.params;
    const invitation = invitationsByToken.get(token);

    if (!invitation) {
      return reply.status(404).send({ error: 'Invitation not found' });
    }

    if (invitation.status !== 'pending') {
      return reply.status(400).send({ error: `Invitation is ${invitation.status}` });
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      invitation.status = 'expired';
      invitations.set(invitation.id, invitation);
      return reply.status(400).send({ error: 'Invitation has expired' });
    }

    const org = organizations.get(invitation.organizationId);

    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt
      },
      organization: org ? { id: org.id, name: org.name } : null
    };
  });

  // POST /api/invitations/:token/accept - Accept invitation
  fastify.post<{ Params: { token: string } }>('/invitations/:token/accept', async (request, reply) => {
    const { token } = request.params;
    const invitation = invitationsByToken.get(token);

    if (!invitation) {
      return reply.status(404).send({ error: 'Invitation not found' });
    }

    if (invitation.status !== 'pending') {
      return reply.status(400).send({ error: `Invitation is ${invitation.status}` });
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      invitation.status = 'expired';
      invitations.set(invitation.id, invitation);
      return reply.status(400).send({ error: 'Invitation has expired' });
    }

    // Add user to organization
    const orgMembers = members.get(invitation.organizationId) ?? [];

    // Check if already a member
    if (orgMembers.some(m => m.userId === MOCK_USER_ID)) {
      return reply.status(400).send({ error: 'Already a member of this organization' });
    }

    orgMembers.push({
      userId: MOCK_USER_ID,
      organizationId: invitation.organizationId,
      role: invitation.role,
      joinedAt: new Date().toISOString()
    });
    members.set(invitation.organizationId, orgMembers);

    // Update invitation status
    invitation.status = 'accepted';
    invitations.set(invitation.id, invitation);

    fastify.log.info(`Invitation accepted: ${MOCK_USER_ID} joined org ${invitation.organizationId}`);

    const org = organizations.get(invitation.organizationId);

    return {
      success: true,
      organization: org
    };
  });

  // GET /api/organizations/:orgId/members - List members
  fastify.get<{ Params: { orgId: string } }>(
    '/organizations/:orgId/members',
    async (request, reply) => {
      const { orgId } = request.params;

      if (!organizations.has(orgId)) {
        return reply.status(404).send({ error: 'Organization not found' });
      }

      const orgMembers = members.get(orgId) ?? [];

      return {
        members: orgMembers,
        total: orgMembers.length
      };
    }
  );

  // DELETE /api/organizations/:orgId/members/:userId - Remove member
  fastify.delete<{ Params: { orgId: string; userId: string } }>(
    '/organizations/:orgId/members/:userId',
    async (request, reply) => {
      const { orgId, userId } = request.params;

      const org = organizations.get(orgId);
      if (!org) {
        return reply.status(404).send({ error: 'Organization not found' });
      }

      // Cannot remove owner
      if (org.ownerId === userId) {
        return reply.status(400).send({ error: 'Cannot remove organization owner' });
      }

      // Check admin permission
      const orgMembers = members.get(orgId) ?? [];
      const currentMember = orgMembers.find(m => m.userId === MOCK_USER_ID);
      if (!currentMember || (currentMember.role !== 'owner' && currentMember.role !== 'admin')) {
        return reply.status(403).send({ error: 'Admin permission required' });
      }

      const updatedMembers = orgMembers.filter(m => m.userId !== userId);
      members.set(orgId, updatedMembers);

      fastify.log.info(`Member ${userId} removed from org ${orgId}`);

      return reply.status(204).send();
    }
  );

  // PATCH /api/organizations/:orgId/members/:userId/role - Update member role
  fastify.patch<{ Params: { orgId: string; userId: string }; Body: UpdateMemberRoleBody }>(
    '/organizations/:orgId/members/:userId/role',
    async (request, reply) => {
      const { orgId, userId } = request.params;
      const { role } = request.body;

      const org = organizations.get(orgId);
      if (!org) {
        return reply.status(404).send({ error: 'Organization not found' });
      }

      // Cannot change owner's role
      if (org.ownerId === userId) {
        return reply.status(400).send({ error: 'Cannot change owner role' });
      }

      // Only owner can change roles
      if (org.ownerId !== MOCK_USER_ID) {
        return reply.status(403).send({ error: 'Only owner can change roles' });
      }

      const orgMembers = members.get(orgId) ?? [];
      const member = orgMembers.find(m => m.userId === userId);

      if (!member) {
        return reply.status(404).send({ error: 'Member not found' });
      }

      member.role = role;
      members.set(orgId, orgMembers);

      return { success: true, userId, role };
    }
  );
};

// Export helpers
export function getOrganization(id: string): Organization | undefined {
  return organizations.get(id);
}

export function getOrganizationMembers(orgId: string): OrganizationMember[] {
  return members.get(orgId) ?? [];
}

/**
 * Remote database models
 * Translates: crates/remote/src/db/
 *
 * Models:
 * - User
 * - Organization
 * - OrganizationMember
 * - Project
 * - Task
 * - Review
 * - Invitation
 * - GithubApp
 */

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
}

export interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

// TODO: Implement remaining models and database operations

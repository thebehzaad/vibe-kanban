/**
 * Database entities
 * Translates: crates/remote/src/entities.rs
 *
 * PostgreSQL database entities for remote deployment.
 */

export interface RemoteUser {
  id: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteOrganization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteProject {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// TODO: Add more entity types as needed

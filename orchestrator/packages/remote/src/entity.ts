/**
 * Entity base types
 * Translates: crates/remote/src/entity.rs
 *
 * Base entity traits and types for PostgreSQL.
 */

export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityWithOwner extends Entity {
  ownerId: string;
}

export interface EntityWithOrganization extends Entity {
  organizationId: string;
}

// TODO: Add entity trait implementations

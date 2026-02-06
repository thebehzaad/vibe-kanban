/**
 * API mutation types
 * Translates: crates/remote/src/mutation_types.rs
 *
 * GraphQL/API mutation request types.
 */

export interface CreateUserInput {
  email: string;
  username?: string;
  password: string;
}

export interface UpdateUserInput {
  username?: string;
  avatarUrl?: string;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  settings?: Record<string, unknown>;
}

export interface CreateProjectInput {
  organizationId: string;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

// TODO: Add more mutation types

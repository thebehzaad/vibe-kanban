/**
 * Organizations API types
 * Translates: crates/utils/src/api/organizations.rs
 *
 * API types for organization operations.
 */

export interface OrganizationMember {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface CreateOrganizationRequest {
  name: string;
  description?: string;
  slug?: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  description?: string;
  settings?: Record<string, unknown>;
}

export interface InviteMemberRequest {
  email: string;
  role: 'admin' | 'member';
}

export interface InvitationResponse {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
}

export interface AcceptInvitationRequest {
  token: string;
}

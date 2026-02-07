/**
 * Organizations API types
 * Translates: crates/utils/src/api/organizations.rs
 */

/** Matches Rust: #[serde(rename_all = "SCREAMING_SNAKE_CASE")] */
export enum MemberRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

/** Matches Rust: #[serde(rename_all = "SCREAMING_SNAKE_CASE")] */
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  issuePrefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationWithRole {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  issuePrefix: string;
  createdAt: string;
  updatedAt: string;
  userRole: MemberRole;
}

export interface ListOrganizationsResponse {
  organizations: OrganizationWithRole[];
}

export interface GetOrganizationResponse {
  organization: Organization;
  userRole: string;
}

export interface CreateOrganizationRequest {
  name: string;
  slug: string;
}

export interface CreateOrganizationResponse {
  organization: OrganizationWithRole;
}

export interface UpdateOrganizationRequest {
  name: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  invitedByUserId?: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateInvitationRequest {
  email: string;
  role: MemberRole;
}

export interface CreateInvitationResponse {
  invitation: Invitation;
}

export interface ListInvitationsResponse {
  invitations: Invitation[];
}

export interface GetInvitationResponse {
  id: string;
  organizationSlug: string;
  role: MemberRole;
  expiresAt: string;
}

export interface AcceptInvitationResponse {
  organizationId: string;
  organizationSlug: string;
  role: MemberRole;
}

export interface RevokeInvitationRequest {
  invitationId: string;
}

export interface OrganizationMember {
  userId: string;
  role: MemberRole;
  joinedAt: string;
}

export interface OrganizationMemberWithProfile {
  userId: string;
  role: MemberRole;
  joinedAt: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  avatarUrl?: string;
}

export interface ListMembersResponse {
  members: OrganizationMemberWithProfile[];
}

export interface UpdateMemberRoleRequest {
  role: MemberRole;
}

export interface UpdateMemberRoleResponse {
  userId: string;
  role: MemberRole;
}

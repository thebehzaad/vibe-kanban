/**
 * API routes
 * Translates: crates/server/src/routes/
 *
 * Complete route module exports for the orchestrator server.
 */

// Core routes
export { healthRoutes, type HealthResponse } from './health.js';
export {
  configRoutes,
  type SystemInfo,
  type ExecutorProfile,
  type Capabilities,
  type AppConfig,
  type McpServerConfig,
  type UpdateConfigBody,
  type LoginStatus as ConfigLoginStatus
} from './config.js';
export { eventRoutes, emitEvent, type ServerEvent, type EventType } from './events.js';

// Entity CRUD
export { projectRoutes, type Project, type CreateProjectBody, type UpdateProjectBody } from './projects.js';
export { taskRoutes, type Task, type CreateTaskBody, type UpdateTaskBody } from './tasks.js';
export {
  sessionRoutes,
  type Session,
  type CreateSessionBody,
  type QueueMessageBody
} from './sessions.js';
export {
  repoRoutes,
  type Repository,
  type Branch,
  type Remote,
  type PullRequest,
  type CreateRepoBody,
  type UpdateRepoBody,
  type InitRepoBody
} from './repos.js';
export {
  organizationRoutes,
  type Organization,
  type OrganizationMember,
  type Invitation,
  type CreateOrganizationBody,
  type UpdateOrganizationBody
} from './organizations.js';
export { tagRoutes, type Tag, type CreateTagBody, type UpdateTagBody } from './tags.js';

// Workspace management
export {
  taskAttemptRoutes,
  type Workspace,
  type WorkspaceStatus,
  type BranchStatus,
  type DiffFile,
  type DiffHunk,
  type WorkspaceSummary,
  type CreateWorkspaceBody,
  type UpdateWorkspaceBody,
  type CreatePRBody,
  type RebaseBody,
  type MergeBody,
  updateWorkspaceDiff
} from './task-attempts.js';

// Execution & processes
export {
  executionProcessRoutes,
  type ExecutionProcess,
  type ExecutionStatus,
  addRawLog,
  addNormalizedLog
} from './execution-processes.js';
export {
  approvalRoutes,
  type Approval,
  type ApprovalType,
  type ApprovalResponse,
  createApproval
} from './approvals.js';

// File & content
export {
  filesystemRoutes,
  type DirectoryEntry,
  type DirectoryListing,
  type GitRepo
} from './filesystem.js';
export {
  imageRoutes,
  type Image,
  type ImageMetadata
} from './images.js';
export {
  scratchRoutes,
  type ScratchType,
  type ScratchItem,
  type CreateScratchBody,
  type UpdateScratchBody,
  getScratchItem,
  setScratchItem
} from './scratch.js';
export {
  searchRoutes,
  type SearchResult,
  type SearchResponse,
  type SearchMode
} from './search.js';

// Infrastructure
export {
  containerRoutes,
  type ContainerInfo,
} from './containers.js';
export {
  terminalRoutes,
  type TerminalSession,
  type TerminalOptions,
  getTerminalSession,
  killTerminalSession,
  killWorkspaceTerminals
} from './terminal.js';
export {
  oauthRoutes,
  type AuthUser,
  type AuthSession,
  type LoginStatus,
  getCurrentUser,
  getCurrentUserId,
  isAuthenticated,
  requireAuth
} from './oauth.js';

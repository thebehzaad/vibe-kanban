/**
 * @orchestrator/services
 *
 * Business logic services for orchestrator.
 * TypeScript translation of crates/services.
 *
 * Services to implement:
 * - GitService (git operations)
 * - ContainerService (Docker management)
 * - FilesystemService (virtual filesystem)
 * - ProjectService (project management)
 * - RepoService (repository management)
 * - ConfigService (configuration)
 * - EventsService (event streaming)
 * - ImageService (image processing)
 * - AnalyticsService (telemetry)
 * - ApprovalsService (approval workflows)
 * - GitHubService (GitHub integration)
 * - NotificationService (notifications)
 * - WorkspaceManagerService (workspace management)
 */

export * from './git.js';
export * from './container.js';
export * from './filesystem.js';
export * from './project.js';
export * from './config.js';
export * from './events.js';

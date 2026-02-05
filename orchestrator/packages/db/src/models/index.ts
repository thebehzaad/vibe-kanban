/**
 * Database models
 * Translates: crates/db/src/models/
 *
 * Complete model exports for the orchestrator database layer.
 */

// Project model
export {
  type Project,
  type CreateProject,
  type UpdateProject,
  type SearchResult,
  type SearchMatchType,
  ProjectRepository
} from './project.js';

// Task model
export {
  type Task,
  type TaskStatus,
  type TaskWithAttemptStatus,
  type CreateTask,
  type UpdateTask,
  TaskRepository
} from './task.js';

// Session model
export {
  type Session,
  type CreateSession,
  SessionRepository
} from './session.js';

// Workspace model
export {
  type Workspace,
  type WorkspaceWithStatus,
  type ContainerInfo,
  type CreateWorkspace,
  type UpdateWorkspace,
  WorkspaceRepository
} from './workspace.js';

// Repo model
export {
  type Repo,
  type UpdateRepo,
  RepoRepository
} from './repo.js';

// ExecutionProcess model
export {
  type ExecutionProcess,
  type ExecutionProcessStatus,
  type ExecutionProcessRunReason,
  type CreateExecutionProcess,
  type CreateExecutionProcessRepoState,
  type ExecutionProcessRepoState,
  type LatestProcessInfo,
  ExecutionProcessRepository
} from './execution-process.js';

// Image model
export {
  type Image,
  type CreateImage,
  ImageRepository
} from './image.js';

// Tag model
export {
  type Tag,
  type CreateTag,
  type UpdateTag,
  type TagAssignment,
  TagRepository
} from './tag.js';

// Scratch model
export {
  type ScratchType,
  type ScratchItem,
  type CreateScratchItem,
  type UpdateScratchItem,
  ScratchRepository
} from './scratch.js';

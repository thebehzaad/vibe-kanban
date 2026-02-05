/**
 * Database models
 * Translates: crates/db/src/models/
 *
 * Models to implement:
 * - CodingAgentTurn
 * - ExecutionProcess
 * - ExecutionProcessLogs
 * - ExecutionProcessRepoState
 * - Image
 * - Merge
 * - Project
 * - ProjectRepo
 * - Repo
 * - Scratch
 * - Session
 * - Tag
 * - Task
 * - Workspace
 */

// Placeholder exports - implement each model
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
}

// TODO: Implement remaining models

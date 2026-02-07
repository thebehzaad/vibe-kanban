/**
 * Project service - Full implementation
 * Translates: crates/services/src/project.rs
 */

import type { DBService, Project, CreateProject, UpdateProject, ProjectRepository } from '@runner/db';

export interface ProjectServiceConfig {
  db: DBService;
}

export class ProjectService {
  private repo: ProjectRepository;

  constructor(private config: ProjectServiceConfig) {
    this.repo = new ProjectRepository(config.db);
  }

  async createProject(name: string, options?: { defaultAgentWorkingDir?: string; remoteProjectId?: string }): Promise<Project> {
    return this.repo.create({
      name,
      defaultAgentWorkingDir: options?.defaultAgentWorkingDir ?? null,
      remoteProjectId: options?.remoteProjectId ?? null,
    });
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.repo.findById(id);
  }

  async listProjects(): Promise<Project[]> {
    return this.repo.findAll();
  }

  async listActiveProjects(limit: number = 10): Promise<Project[]> {
    return this.repo.findMostActive(limit);
  }

  async updateProject(id: string, updates: UpdateProject): Promise<Project | undefined> {
    return this.repo.update(id, updates);
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }

  async getProjectStatistics(id: string): Promise<ProjectStats> {
    const db = this.config.db;

    const taskCount = db.prepare(
      'SELECT COUNT(*) as count FROM tasks WHERE project_id = ?'
    ).get(id) as { count: number } | undefined;

    const workspaceCount = db.prepare(
      `SELECT COUNT(*) as count FROM workspaces w
       JOIN tasks t ON w.task_id = t.id
       WHERE t.project_id = ?`
    ).get(id) as { count: number } | undefined;

    const activeWorkspaceCount = db.prepare(
      `SELECT COUNT(*) as count FROM workspaces w
       JOIN tasks t ON w.task_id = t.id
       WHERE t.project_id = ? AND w.archived = 0`
    ).get(id) as { count: number } | undefined;

    return {
      taskCount: taskCount?.count ?? 0,
      workspaceCount: workspaceCount?.count ?? 0,
      activeWorkspaceCount: activeWorkspaceCount?.count ?? 0,
    };
  }

  async findByRemoteProjectId(remoteId: string): Promise<Project | undefined> {
    return this.repo.findByRemoteProjectId(remoteId);
  }

  async count(): Promise<number> {
    return this.repo.count();
  }
}

export interface ProjectStats {
  taskCount: number;
  workspaceCount: number;
  activeWorkspaceCount: number;
}

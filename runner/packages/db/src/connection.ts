/**
 * Database connection management
 * Translates: crates/db/src/lib.rs
 */

import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getAssetDir } from '@runner/utils';

export interface DbConfig {
  /** Path to the SQLite database file. If not provided, uses default asset directory */
  dbPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Database service that wraps better-sqlite3
 * Translates: pub struct DBService { pub pool: Pool<Sqlite> }
 */
export class DBService {
  private db: DatabaseType;
  private dbPath: string;

  private constructor(db: DatabaseType, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /**
   * Create a new DBService instance
   * Translates: pub async fn new() -> Result<DBService, Error>
   */
  static async create(config: DbConfig = {}): Promise<DBService> {
    const dbPath = config.dbPath ?? path.join(getAssetDir(), 'db.sqlite');

    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const db = new Database(dbPath, {
      verbose: config.verbose ? console.log : undefined,
    });

    // Rust uses SqliteJournalMode::Delete
    db.pragma('journal_mode = DELETE');

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    const service = new DBService(db, dbPath);

    // Run migrations
    await service.runMigrations();

    return service;
  }

  /**
   * Create a new DBService with an after-connect hook
   * Translates: pub async fn new_with_after_connect<F>(after_connect: F) -> Result<DBService, Error>
   */
  static async createWithAfterConnect(
    afterConnect: (db: DatabaseType) => void,
    config: DbConfig = {},
  ): Promise<DBService> {
    const service = await DBService.create(config);
    afterConnect(service.db);
    return service;
  }

  /**
   * Get the underlying database instance for direct queries
   */
  get database(): DatabaseType {
    return this.db;
  }

  /**
   * Get the database file path
   */
  get databasePath(): string {
    return this.dbPath;
  }

  /**
   * Run database migrations
   * Translates: async fn run_migrations(pool: &Pool<Sqlite>) -> Result<(), Error>
   */
  private async runMigrations(): Promise<void> {
    // Create migrations tracking table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _sqlx_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum BLOB,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Get list of applied migrations
    const appliedVersions = new Set(
      this.db
        .prepare('SELECT version FROM _sqlx_migrations')
        .all()
        .map((row: any) => row.version as number),
    );

    // Define migrations (in order)
    const migrations = this.getMigrations();

    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        const transaction = this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db
            .prepare('INSERT INTO _sqlx_migrations (version, name) VALUES (?, ?)')
            .run(migration.version, migration.name);
        });

        transaction();
      }
    }
  }

  /**
   * Get all migrations to apply
   */
  private getMigrations(): Array<{ version: number; name: string; sql: string }> {
    return [
      {
        version: 1,
        name: 'create_projects',
        sql: `
          CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            default_agent_working_dir TEXT,
            remote_project_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_projects_remote_project_id ON projects(remote_project_id);
        `,
      },
      {
        version: 2,
        name: 'create_repos',
        sql: `
          CREATE TABLE IF NOT EXISTS repos (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            setup_script TEXT,
            cleanup_script TEXT,
            archive_script TEXT,
            copy_files TEXT,
            parallel_setup_script INTEGER NOT NULL DEFAULT 0,
            dev_server_script TEXT,
            default_target_branch TEXT,
            default_working_dir TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_repos_path ON repos(path);
        `,
      },
      {
        version: 3,
        name: 'create_project_repos',
        sql: `
          CREATE TABLE IF NOT EXISTS project_repos (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            is_primary INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(project_id, repo_id)
          );
          CREATE INDEX IF NOT EXISTS idx_project_repos_project_id ON project_repos(project_id);
          CREATE INDEX IF NOT EXISTS idx_project_repos_repo_id ON project_repos(repo_id);
        `,
      },
      {
        version: 4,
        name: 'create_tasks',
        sql: `
          CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'todo',
            parent_workspace_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
          CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
          CREATE INDEX IF NOT EXISTS idx_tasks_parent_workspace_id ON tasks(parent_workspace_id);
        `,
      },
      {
        version: 5,
        name: 'create_workspaces',
        sql: `
          CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            container_ref TEXT,
            branch TEXT NOT NULL,
            agent_working_dir TEXT,
            setup_completed_at TEXT,
            archived INTEGER NOT NULL DEFAULT 0,
            pinned INTEGER NOT NULL DEFAULT 0,
            name TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_workspaces_task_id ON workspaces(task_id);
          CREATE INDEX IF NOT EXISTS idx_workspaces_container_ref ON workspaces(container_ref);
          CREATE INDEX IF NOT EXISTS idx_workspaces_archived ON workspaces(archived);
        `,
      },
      {
        version: 6,
        name: 'create_workspace_repos',
        sql: `
          CREATE TABLE IF NOT EXISTS workspace_repos (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            target_branch TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(workspace_id, repo_id)
          );
          CREATE INDEX IF NOT EXISTS idx_workspace_repos_workspace_id ON workspace_repos(workspace_id);
          CREATE INDEX IF NOT EXISTS idx_workspace_repos_repo_id ON workspace_repos(repo_id);
        `,
      },
      {
        version: 7,
        name: 'create_sessions',
        sql: `
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            executor TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);
        `,
      },
      {
        version: 8,
        name: 'create_execution_processes',
        sql: `
          CREATE TABLE IF NOT EXISTS execution_processes (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            run_reason TEXT NOT NULL,
            executor_action TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            exit_code INTEGER,
            dropped INTEGER NOT NULL DEFAULT 0,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_execution_processes_session_id ON execution_processes(session_id);
          CREATE INDEX IF NOT EXISTS idx_execution_processes_status ON execution_processes(status);
          CREATE INDEX IF NOT EXISTS idx_execution_processes_run_reason ON execution_processes(run_reason);
        `,
      },
      {
        version: 9,
        name: 'create_execution_process_repo_states',
        sql: `
          CREATE TABLE IF NOT EXISTS execution_process_repo_states (
            id TEXT PRIMARY KEY,
            execution_process_id TEXT NOT NULL REFERENCES execution_processes(id) ON DELETE CASCADE,
            repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            before_head_commit TEXT,
            after_head_commit TEXT,
            merge_commit TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(execution_process_id, repo_id)
          );
          CREATE INDEX IF NOT EXISTS idx_eprs_execution_process_id ON execution_process_repo_states(execution_process_id);
          CREATE INDEX IF NOT EXISTS idx_eprs_repo_id ON execution_process_repo_states(repo_id);
        `,
      },
      {
        version: 10,
        name: 'create_execution_process_logs',
        sql: `
          CREATE TABLE IF NOT EXISTS execution_process_logs (
            execution_id TEXT NOT NULL REFERENCES execution_processes(id) ON DELETE CASCADE,
            logs TEXT NOT NULL,
            byte_size INTEGER NOT NULL DEFAULT 0,
            inserted_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_epl_execution_id ON execution_process_logs(execution_id);
        `,
      },
      {
        version: 11,
        name: 'create_coding_agent_turns',
        sql: `
          CREATE TABLE IF NOT EXISTS coding_agent_turns (
            id TEXT PRIMARY KEY,
            execution_process_id TEXT NOT NULL REFERENCES execution_processes(id) ON DELETE CASCADE,
            agent_session_id TEXT,
            agent_message_id TEXT,
            prompt TEXT,
            summary TEXT,
            seen INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_cat_execution_process_id ON coding_agent_turns(execution_process_id);
          CREATE INDEX IF NOT EXISTS idx_cat_agent_session_id ON coding_agent_turns(agent_session_id);
        `,
      },
      {
        version: 12,
        name: 'create_images',
        sql: `
          CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT,
            size_bytes INTEGER NOT NULL,
            hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash);
          CREATE INDEX IF NOT EXISTS idx_images_file_path ON images(file_path);
        `,
      },
      {
        version: 13,
        name: 'create_task_images',
        sql: `
          CREATE TABLE IF NOT EXISTS task_images (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(task_id, image_id)
          );
          CREATE INDEX IF NOT EXISTS idx_task_images_task_id ON task_images(task_id);
          CREATE INDEX IF NOT EXISTS idx_task_images_image_id ON task_images(image_id);
        `,
      },
      {
        version: 14,
        name: 'create_tags',
        sql: `
          CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            tag_name TEXT NOT NULL UNIQUE,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_tags_tag_name ON tags(tag_name);
        `,
      },
      {
        version: 15,
        name: 'create_scratch',
        sql: `
          CREATE TABLE IF NOT EXISTS scratch (
            id TEXT PRIMARY KEY,
            scratch_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_scratch_type ON scratch(scratch_type);
        `,
      },
      {
        version: 16,
        name: 'create_merges',
        sql: `
          CREATE TABLE IF NOT EXISTS direct_merges (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            merge_commit TEXT NOT NULL,
            target_branch_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_direct_merges_workspace_id ON direct_merges(workspace_id);

          CREATE TABLE IF NOT EXISTS pr_merges (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            target_branch_name TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            pr_url TEXT NOT NULL,
            pr_status TEXT NOT NULL DEFAULT 'open',
            merged_at TEXT,
            merge_commit_sha TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_pr_merges_workspace_id ON pr_merges(workspace_id);
          CREATE INDEX IF NOT EXISTS idx_pr_merges_status ON pr_merges(pr_status);
        `,
      },
      {
        version: 17,
        name: 'create_migration_states',
        sql: `
          CREATE TABLE IF NOT EXISTS migration_states (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            local_id TEXT NOT NULL,
            remote_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(entity_type, local_id)
          );
          CREATE INDEX IF NOT EXISTS idx_migration_states_entity_type ON migration_states(entity_type);
          CREATE INDEX IF NOT EXISTS idx_migration_states_status ON migration_states(status);
        `,
      },
    ];
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Execute a raw SQL query
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Prepare a statement for repeated execution
   */
  prepare<BindParameters extends unknown[] | {} = unknown[], Result = unknown>(
    sql: string,
  ): Statement<BindParameters, Result> {
    return this.db.prepare(sql);
  }

  /**
   * Run a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

// Re-export types
export type { Database as DatabaseType, Statement } from 'better-sqlite3';

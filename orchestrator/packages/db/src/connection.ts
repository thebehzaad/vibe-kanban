/**
 * Database connection management
 * Translates: crates/db/src/lib.rs
 */

import Database, { Database as DatabaseType, Statement } from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

export interface DbConfig {
  /** Path to the SQLite database file. If not provided, uses default asset directory */
  dbPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Enable WAL mode for better concurrency */
  walMode?: boolean;
}

/**
 * Get the default asset directory for storing data files.
 * Mimics the Rust utils::assets::asset_dir() function.
 */
export function getAssetDir(): string {
  // Use platform-specific data directory
  const platform = os.platform();
  let baseDir: string;

  if (platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    baseDir = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    baseDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }

  const assetDir = path.join(baseDir, 'vibe-kanban');

  // Ensure directory exists
  if (!fs.existsSync(assetDir)) {
    fs.mkdirSync(assetDir, { recursive: true });
  }

  return assetDir;
}

/**
 * Database service that wraps better-sqlite3
 * Provides the same interface as the Rust DBService
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
   */
  static async create(config: DbConfig = {}): Promise<DBService> {
    const dbPath = config.dbPath ?? path.join(getAssetDir(), 'db.sqlite');

    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const db = new Database(dbPath, {
      verbose: config.verbose ? console.log : undefined
    });

    // Enable WAL mode for better concurrency (similar to Rust's SqliteJournalMode)
    if (config.walMode !== false) {
      db.pragma('journal_mode = WAL');
    }

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    const service = new DBService(db, dbPath);

    // Run migrations
    await service.runMigrations();

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
  get path(): string {
    return this.dbPath;
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    // Create migrations tracking table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Get list of applied migrations
    const appliedVersions = new Set(
      this.db.prepare('SELECT version FROM _migrations').all()
        .map((row: any) => row.version as number)
    );

    // Define migrations (in order)
    const migrations = this.getMigrations();

    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        console.log(`Applying migration ${migration.version}: ${migration.name}`);

        const transaction = this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db.prepare(
            'INSERT INTO _migrations (version, name) VALUES (?, ?)'
          ).run(migration.version, migration.name);
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
        `
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
        `
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
        `
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
        `
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
        `
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
            worktree_path TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(workspace_id, repo_id)
          );
          CREATE INDEX IF NOT EXISTS idx_workspace_repos_workspace_id ON workspace_repos(workspace_id);
          CREATE INDEX IF NOT EXISTS idx_workspace_repos_repo_id ON workspace_repos(repo_id);
        `
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
        `
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
        `
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
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(execution_process_id, repo_id)
          );
          CREATE INDEX IF NOT EXISTS idx_eprs_execution_process_id ON execution_process_repo_states(execution_process_id);
          CREATE INDEX IF NOT EXISTS idx_eprs_repo_id ON execution_process_repo_states(repo_id);
        `
      },
      {
        version: 10,
        name: 'create_execution_process_logs',
        sql: `
          CREATE TABLE IF NOT EXISTS execution_process_logs (
            id TEXT PRIMARY KEY,
            execution_process_id TEXT NOT NULL REFERENCES execution_processes(id) ON DELETE CASCADE,
            log_type TEXT NOT NULL,
            content TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_epl_execution_process_id ON execution_process_logs(execution_process_id);
          CREATE INDEX IF NOT EXISTS idx_epl_sequence ON execution_process_logs(execution_process_id, sequence);
        `
      },
      {
        version: 11,
        name: 'create_coding_agent_turns',
        sql: `
          CREATE TABLE IF NOT EXISTS coding_agent_turns (
            id TEXT PRIMARY KEY,
            execution_process_id TEXT NOT NULL REFERENCES execution_processes(id) ON DELETE CASCADE,
            turn_number INTEGER NOT NULL,
            prompt TEXT,
            response TEXT,
            tool_calls TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_cat_execution_process_id ON coding_agent_turns(execution_process_id);
        `
      },
      {
        version: 12,
        name: 'create_images',
        sql: `
          CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            path TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_images_task_id ON images(task_id);
        `
      },
      {
        version: 13,
        name: 'create_tags',
        sql: `
          CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
        `
      },
      {
        version: 14,
        name: 'create_tag_assignments',
        sql: `
          CREATE TABLE IF NOT EXISTS tag_assignments (
            id TEXT PRIMARY KEY,
            tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(tag_id, entity_type, entity_id)
          );
          CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag_id ON tag_assignments(tag_id);
          CREATE INDEX IF NOT EXISTS idx_tag_assignments_entity ON tag_assignments(entity_type, entity_id);
        `
      },
      {
        version: 15,
        name: 'create_scratch',
        sql: `
          CREATE TABLE IF NOT EXISTS scratch (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            metadata TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(type, key)
          );
          CREATE INDEX IF NOT EXISTS idx_scratch_type_key ON scratch(type, key);
        `
      },
      {
        version: 16,
        name: 'create_merges',
        sql: `
          CREATE TABLE IF NOT EXISTS merges (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            source_branch TEXT NOT NULL,
            target_branch TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            merge_commit TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_merges_workspace_id ON merges(workspace_id);
          CREATE INDEX IF NOT EXISTS idx_merges_status ON merges(status);
        `
      }
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
    sql: string
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

// Type alias for backwards compatibility with deployment interface
export type DbPool = DBService;

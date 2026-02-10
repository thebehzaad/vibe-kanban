# Feature Flows

Implementation details for core features, tracing each from UI to database.

---

## Add Repository

### What the user sees

Three ways to add a repo:

1. **Add to project** — Project Settings page, "Add Repository" button opens a repo picker dialog
2. **Browse existing** — Folder picker dialog to select a local git repo directory
3. **Create new** — Form with `parent_path` and `folder_name`, runs `git init`

### Frontend

**Components:**

| Component | File |
|-----------|------|
| Add to project | `frontend/src/pages/settings/ProjectSettings.tsx` |
| Browse existing | `frontend/src/components/ui-new/containers/BrowseRepoButtonContainer.tsx` |
| Create new | `frontend/src/components/ui-new/dialogs/CreateRepoDialog.tsx` |

**API calls** (`frontend/src/lib/api.ts`):

| Action | Method | Endpoint | Request body |
|--------|--------|----------|--------------|
| Add to project | POST | `/api/projects/{projectId}/repositories` | `{display_name, git_repo_path}` |
| Register existing | POST | `/api/repos` | `{path, display_name?}` |
| Create new | POST | `/api/repos/init` | `{parent_path, folder_name}` |

### Backend

**Route handlers** in `crates/server/src/routes/projects.rs`:

**`add_project_repository`** — POST `/api/projects/{id}/repositories`
1. Receives `CreateProjectRepo {display_name, git_repo_path}`
2. Calls `ProjectService::add_repository()`

**`register_repo`** — POST `/api/repos`
1. Receives `RegisterRepoRequest {path, display_name?}`
2. Calls `RepoService::register()`

**`init_repo`** — POST `/api/repos/init`
1. Receives `InitRepoRequest {parent_path, folder_name}`
2. Calls `RepoService::init_repo()`

### Service layer

**`RepoService::register()`** (`crates/services/src/services/repo.rs`):
1. `normalize_path()` — resolves to absolute path
2. `validate_git_repo_path()` — checks path exists and is a git repo (has `.git`)
3. `Repo::find_or_create()` — inserts into `repos` table or returns existing by path

**`RepoService::init_repo()`** (`crates/services/src/services/repo.rs`):
1. Validates folder name (no slashes, not `.` or `..`)
2. Checks parent directory exists
3. Checks target directory doesn't already exist
4. Calls `GitService::initialize_repo_with_main_branch()` — runs `git init`
5. `Repo::find_or_create()` — inserts into DB

**`ProjectService::add_repository()`** (`crates/services/src/services/project.rs`):
1. Normalizes and validates path via `RepoService`
2. Calls `ProjectRepo::add_repo_to_project()` which:
   - `Repo::find_or_create()` — ensures repo exists in `repos` table
   - Checks for duplicate via `find_by_project_and_repo()`
   - Inserts into `project_repos` junction table
3. Returns the `Repo` object

### Database

```
repos                          project_repos (junction)
─────────────────────          ──────────────────────────
id         BLOB PK             id          BLOB PK
path       TEXT UNIQUE         project_id  BLOB FK → projects
name       TEXT                repo_id     BLOB FK → repos
display_name TEXT              setup_script    TEXT
created_at TEXT                cleanup_script  TEXT
updated_at TEXT                copy_files      TEXT
                               parallel_setup_script INTEGER
                               UNIQUE(project_id, repo_id)
```

### Error cases

| Error | Cause |
|-------|-------|
| `PathNotFound` | Directory doesn't exist on filesystem |
| `NotGitRepository` | Directory exists but has no `.git` |
| `DuplicateGitRepoPath` | Repo already linked to this project |
| `InvalidFolderName` | Name contains `/`, `\`, or is `.`/`..` |
| `DirectoryAlreadyExists` | Target path already exists (for `init`) |

---

## Add Task

### What the user sees

A dialog form (`TaskFormDialog`) with:
- **Title** (required)
- **Description** (optional, rich text editor)
- **Auto-start toggle** — when enabled, also shows:
  - Executor profile selector (e.g. Claude Code)
  - Repository + branch selectors (one or more)
- **Image upload** via drag-and-drop

Keyboard shortcuts: `Cmd+Enter` submits, `Shift+Cmd+Enter` creates without auto-start.

### Frontend

**Components:**

| Component | File |
|-----------|------|
| Task form dialog | `frontend/src/components/dialogs/tasks/TaskFormDialog.tsx` |
| Task mutations hook | `frontend/src/hooks/useTaskMutations.ts` |

**Form type:**

```typescript
type TaskFormValues = {
  title: string;
  description: string;
  status: TaskStatus;
  executorProfileId: ExecutorProfileId | null;
  repoBranches: RepoBranch[];
  autoStart: boolean;
};
```

**API calls** (`frontend/src/lib/api.ts`):

| Action | Method | Endpoint | Request body |
|--------|--------|----------|--------------|
| Create only | POST | `/api/tasks` | `CreateTask` |
| Create + start | POST | `/api/tasks/create-and-start` | `CreateAndStartTaskRequest` |

**Request types** (`shared/types.ts`):

```typescript
// Create only
CreateTask = {
  project_id: string,
  title: string,
  description: string | null,
  status: TaskStatus | null,         // defaults to "todo"
  parent_workspace_id: string | null, // set when creating subtasks
  image_ids: Array<string> | null
}

// Create + start
CreateAndStartTaskRequest = {
  task: CreateTask,
  executor_profile_id: ExecutorProfileId,
  repos: Array<{ repo_id: string, target_branch: string }>
}
```

**Mutation hook** (`frontend/src/hooks/useTaskMutations.ts`):

```typescript
useTaskMutations(projectId?) → {
  createTask,      // calls tasksApi.create()
  createAndStart,  // calls tasksApi.createAndStart()
  updateTask,
  deleteTask,
}
```

On success, both mutations invalidate task query caches and navigate to the task's latest attempt.

### Backend

**Route handlers** in `crates/server/src/routes/tasks.rs`:

**`create_task`** — POST `/api/tasks`
1. Generates `Uuid::new_v4()` for task ID
2. `Task::create()` — inserts into `tasks` table
3. `TaskImage::associate_many_dedup()` — links uploaded images
4. Tracks analytics event `task_created`
5. Returns `Task`

**`create_task_and_start`** — POST `/api/tasks/create-and-start`
1. Validates at least one repo is provided
2. Creates task (same as above)
3. Creates workspace:
   - Generates branch name via `container.git_branch_from_workspace()`
   - Computes `agent_working_dir` (repo name, or repo name + subdir if `default_working_dir` is set)
   - `Workspace::create()` — inserts into `task_attempts` table
4. `WorkspaceRepo::create_many()` — links repos to workspace in `attempt_repos` table
5. **Starts workspace** via `container.start_workspace()`:
   - Creates physical workspace (directory or container)
   - Clones repos and checks out branches
   - Creates a `Session` record
   - Runs setup scripts → `ExecutionProcess` with `run_reason: SetupScript`
   - Starts coding agent → `ExecutionProcess` with `run_reason: CodingAgent`
6. Returns `TaskWithAttemptStatus`

### Post-creation chain

When auto-start is enabled, the backend creates a chain of records:

```
Task
 └── Workspace (aka TaskAttempt)
      ├── WorkspaceRepo (one per selected repo, with target_branch)
      └── Session (executor type, e.g. CLAUDE_CODE)
           ├── ExecutionProcess (SetupScript) — runs setup script if configured
           └── ExecutionProcess (CodingAgent) — starts the AI agent
                └── ExecutionProcessRepoState — tracks git changes per repo
```

The frontend then:
1. Navigates to the task's latest attempt view
2. Connects WebSocket to `/api/sessions/{id}/execution-processes/stream/ws` for live process state
3. Connects WebSocket to `/api/execution-processes/{id}/raw-logs/ws` for live agent logs

### Database

**tasks:**

```
id                   BLOB PK
project_id           BLOB FK → projects
title                TEXT
description          TEXT nullable
status               TEXT (todo | inprogress | inreview | done | cancelled)
parent_workspace_id  BLOB nullable FK → task_attempts (for subtasks)
created_at           TEXT
updated_at           TEXT
```

**task_attempts (workspaces):**

```
id                 BLOB PK
task_id            BLOB FK → tasks
container_ref      TEXT nullable   (path to workspace directory)
branch             TEXT            (git branch name)
agent_working_dir  TEXT nullable   (working dir relative to container_ref)
setup_completed_at TEXT nullable
archived           BOOLEAN
pinned             BOOLEAN
name               TEXT nullable
created_at         TEXT
updated_at         TEXT
```

**attempt_repos:**

```
id            BLOB PK
attempt_id    BLOB FK → task_attempts
repo_id       BLOB FK → repos
target_branch TEXT
created_at    TEXT
updated_at    TEXT
UNIQUE(attempt_id, repo_id)
```

**sessions:**

```
id           BLOB PK
workspace_id BLOB FK → task_attempts
executor     TEXT nullable (e.g. "CLAUDE_CODE")
created_at   TEXT
updated_at   TEXT
```

**execution_processes:**

```
id              BLOB PK
session_id      BLOB FK → sessions
run_reason      TEXT (setupscript | cleanupscript | archivescript | codingagent | devserver)
executor_action JSON
status          TEXT (running | completed | failed | killed)
exit_code       INTEGER nullable
dropped         BOOLEAN
started_at      TEXT
completed_at    TEXT nullable
created_at      TEXT
updated_at      TEXT
```

### Error cases

| Error | Cause |
|-------|-------|
| `BadRequest` | No repos provided in create-and-start |
| `RepoError::NotFound` | Referenced repo ID doesn't exist |
| `start_workspace` failure | Container/agent setup failed (task still created, attempt marked failed) |

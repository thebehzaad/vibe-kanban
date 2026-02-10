# Domain Model

All core entities, their relationships, and lifecycle states.

---

## Entity Hierarchy

```
Project
├── ProjectRepo ←→ Repo
├── Task
│   ├── TaskImage ←→ Image
│   └── Workspace
│       ├── WorkspaceRepo ←→ Repo (with target branch)
│       ├── Merge (direct or PR)
│       └── Session
│           └── ExecutionProcess
│               ├── ExecutionProcessRepoState (git before/after)
│               ├── ExecutionProcessLogs
│               └── CodingAgentTurn (prompt + summary)
│
Shared (not scoped to a project):
├── Repo
├── Image
├── Tag
├── Scratch (drafts, notes, UI preferences)
└── MigrationState (remote sync tracking)
```

---

## Entities

### Project

Top-level container that groups repositories and tasks.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `name` | String | |
| `default_agent_working_dir` | String? | Default working dir for new workspaces |
| `remote_project_id` | UUID? | Links to remote/cloud instance |

**Children:** Task (1:N), ProjectRepo (1:N)

---

### Task

A unit of work within a project.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `project_id` | UUID | FK → Project |
| `title` | String | |
| `description` | String? | Rich text |
| `status` | TaskStatus | Lifecycle state |
| `parent_workspace_id` | UUID? | FK → Workspace, makes this a subtask |

**Status lifecycle:**

```
Todo → InProgress → InReview → Done
                 ↘ Cancelled
```

**Parent:** Project
**Children:** Workspace (1:N), TaskImage (1:N)

Subtasks are created by setting `parent_workspace_id` to point at the workspace that spawned them.

---

### Workspace (TaskAttempt)

An isolated execution environment for working on a task. Each attempt at a task creates a new workspace with its own branch and repos.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `task_id` | UUID | FK → Task |
| `container_ref` | String? | Path to workspace directory |
| `branch` | String | Git branch name (auto-generated) |
| `agent_working_dir` | String? | Relative to container_ref |
| `setup_completed_at` | DateTime? | When setup scripts finished |
| `archived` | bool | Soft-archive flag |
| `pinned` | bool | Prevent auto-cleanup |
| `name` | String? | Auto-generated from first prompt |

**Parent:** Task
**Children:** Session (1:N), WorkspaceRepo (1:N), Merge (1:N)

A task can have multiple workspaces — each is a separate attempt with its own branch and repos.

---

### Session

A single executor session within a workspace. A new session is created each time an agent is started or a follow-up is sent.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `workspace_id` | UUID | FK → Workspace |
| `executor` | String? | e.g. `"CLAUDE_CODE"` |

**Parent:** Workspace
**Children:** ExecutionProcess (1:N)

---

### ExecutionProcess

A single running process — could be a setup script, the AI agent, a dev server, etc.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `session_id` | UUID | FK → Session |
| `run_reason` | RunReason | What type of process |
| `executor_action` | JSON | The action being executed |
| `status` | Status | Current state |
| `exit_code` | i64? | Process exit code |
| `dropped` | bool | Soft-delete flag |
| `started_at` | DateTime | |
| `completed_at` | DateTime? | |

**Run reasons:**

| Value | Purpose |
|-------|---------|
| `SetupScript` | Repo setup script (install deps, etc.) |
| `CleanupScript` | Repo cleanup script |
| `ArchiveScript` | Repo archive script |
| `CodingAgent` | AI agent execution |
| `DevServer` | Development server |

**Status lifecycle:**

```
Running → Completed
       → Failed
       → Killed
```

**Parent:** Session
**Children:** ExecutionProcessRepoState (1:N), ExecutionProcessLogs (1:N), CodingAgentTurn (0..1)

---

### Repo

A git repository on the filesystem. Shared across projects and workspaces.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `path` | PathBuf | Filesystem path (unique) |
| `name` | String | Folder name |
| `display_name` | String | User-facing name |
| `setup_script` | String? | Script to run on workspace setup |
| `cleanup_script` | String? | Script to run on cleanup |
| `archive_script` | String? | Script to run on archive |
| `copy_files` | String? | Files to copy into workspace |
| `parallel_setup_script` | bool | Run setup in parallel |
| `dev_server_script` | String? | Command to start dev server |
| `default_target_branch` | String? | Default branch for new workspaces |
| `default_working_dir` | String? | Default subdir for agent |

**Linked via:** ProjectRepo (to projects), WorkspaceRepo (to workspaces)

---

### Merge

Records a git merge or PR for a workspace+repo combination.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `workspace_id` | UUID | FK → Workspace |
| `repo_id` | UUID | FK → Repo |
| `target_branch_name` | String | Branch merged into |

**Two variants:**

| Type | Extra fields |
|------|-------------|
| DirectMerge | `merge_commit` (SHA) |
| PrMerge | `pr_info.number`, `pr_info.url`, `pr_info.status` (open/merged/closed), `pr_info.merged_at`, `pr_info.merge_commit_sha` |

**Parent:** Workspace

---

### CodingAgentTurn

A single conversation turn (prompt → response) during an AI agent execution.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `execution_process_id` | UUID | FK → ExecutionProcess |
| `agent_session_id` | String? | External agent session ID |
| `agent_message_id` | String? | For resume-at functionality |
| `prompt` | String? | User's request |
| `summary` | String? | Agent's final message |
| `seen` | bool | User has viewed this |

**Parent:** ExecutionProcess (1:1 for CodingAgent processes)

---

### Image

An uploaded image file (screenshots, attachments).

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `file_path` | String | Relative path in cache |
| `original_name` | String | Original filename |
| `mime_type` | String? | |
| `size_bytes` | i64 | |
| `hash` | String | SHA256, used for dedup |

**Linked via:** TaskImage junction table (to tasks)

---

### Tag

A reusable text template.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `tag_name` | String | |
| `content` | String | Markdown body |

---

### Scratch

General-purpose storage for drafts, notes, and UI state. Not scoped to any specific entity — addressed by `(scratch_type, id)`.

| Scratch type | Purpose | Payload |
|-------------|---------|---------|
| `DraftTask` | Task description draft | Markdown string |
| `DraftFollowUp` | Follow-up prompt draft | Prompt + executor profile |
| `DraftWorkspace` | New workspace draft | Workspace config |
| `PreviewSettings` | Preview URL + screen size | URL + dimensions |
| `WorkspaceNotes` | Per-workspace notes | Markdown string |
| `UiPreferences` | Sidebar/panel/filter state | JSON blob |

---

### MigrationState

Tracks sync status when migrating local entities to a remote instance.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `entity_type` | EntityType | Project, Task, PrMerge, or Workspace |
| `local_id` | UUID | Local entity ID |
| `remote_id` | UUID? | Remote ID after sync |
| `status` | MigrationStatus | Pending → Migrated / Failed / Skipped |
| `error_message` | String? | |
| `attempt_count` | i64 | Retry count |

---

## Junction Tables

| Table | Relationship | Extra fields |
|-------|-------------|-------------|
| `project_repos` | Project ↔ Repo | setup_script, cleanup_script, copy_files, parallel_setup_script |
| `attempt_repos` | Workspace ↔ Repo | `target_branch` |
| `task_images` | Task ↔ Image | — |
| `execution_process_repo_states` | ExecutionProcess ↔ Repo | `before_head_commit`, `after_head_commit`, `merge_commit` |

---

## Full Lifecycle Example

Creating a task with auto-start produces this chain:

```
1. Project (already exists)
       │
2. Task (status: Todo → InProgress)
       │
3. Workspace (branch: "vk-{short_id}-{slugified-title}")
       │
       ├── WorkspaceRepo × N (one per selected repo, each with target_branch)
       │
4. Session (executor: "CLAUDE_CODE")
       │
       ├── ExecutionProcess (SetupScript, status: Running → Completed)
       │       └── ExecutionProcessRepoState (before_head_commit recorded)
       │
       └── ExecutionProcess (CodingAgent, status: Running)
               ├── ExecutionProcessRepoState (tracks commits)
               ├── ExecutionProcessLogs (streaming stdout/stderr)
               └── CodingAgentTurn (prompt: task title + description)

5. When agent finishes:
       ExecutionProcess status → Completed
       CodingAgentTurn.summary populated

6. User reviews and merges:
       Merge (DirectMerge or PrMerge) created
       ExecutionProcessRepoState.after_head_commit recorded
```

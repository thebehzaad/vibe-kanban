# Orchestrator: Rust to TypeScript Translation - Missing Functionalities

This document tracks missing functionalities in the TypeScript translation of the Rust orchestrator crates.

## Overview

The TypeScript orchestrator (`orchestrator/packages/`) is a translation of the Rust crates. This document lists all missing functionalities that need to be implemented to achieve feature parity.

---

## @orchestrator/services

### ContainerService (`services/src/container.ts`)

**Core Infrastructure:**
- `msg_stores()` - Access to message store map for log streaming
- `store_db_stream_handle()` - Store background task handles for log streaming to DB
- `take_db_stream_handle()` - Retrieve and remove task handles
- `workspace_to_current_dir()` - Convert workspace to filesystem path

**Execution Lifecycle:**
- `start_workspace()` - Initialize workspace with setup scripts → coding agent orchestration
- `start_execution()` - Create ExecutionProcess record and spawn child process
- `start_execution_inner()` - Implementation-specific process spawning (abstract)
- `stop_execution()` - Stop a running execution process with status update
- `try_start_next_action()` - Check for and start next action in chain
- `kill_all_running_processes()` - Emergency kill all processes
- `ensure_container_exists()` - Create or ensure container/worktree exists
- `is_container_clean()` - Check if workspace has uncommitted changes

**Process Monitoring:**
- `has_running_processes()` - Check if task has any running executions
- `should_finalize()` - Determine if execution should finalize task
- `finalize_task()` - Update task status to InReview and send notifications
- `cleanup_orphan_executions()` - Clean up processes orphaned from crashes/restarts

**Script Management:**
- `setup_actions_for_repos()` - Build setup script action chain
- `setup_action_for_repo()` - Create setup action for single repo
- `cleanup_actions_for_repos()` - Build cleanup script action chain
- `archive_actions_for_repos()` - Build archive script action chain
- `try_run_archive_script()` - Conditionally run archive script
- `build_sequential_setup_chain()` - Chain multiple setup scripts sequentially

**Log Streaming:**
- `stream_raw_logs()` - WebSocket stream of stdout/stderr
- `stream_normalized_logs()` - WebSocket stream of parsed/normalized entries
- `get_msg_store_by_id()` - Get message store for execution ID
- `spawn_stream_raw_logs_to_db()` - Background task to persist logs to database

**Git Integration:**
- `git_branch_prefix()` - Get configured git branch prefix
- `git_branch_from_workspace()` - Generate branch name from workspace + task
- `has_commits_from_execution()` - Check if execution made any git commits
- `stream_diff()` - Stream git diff with stats

**Slash Commands:**
- `available_agent_slash_commands()` - Discover available slash commands for executor

**Workspace Management:**
- `try_stop()` - Stop workspace execution, optionally including dev servers
- `create()` - Create workspace container/worktree
- `delete()` - Delete workspace and cleanup resources

### GitService (`services/src/git.ts`)

**Worktree Management:**
- `add_worktree()` - Create git worktree for workspace isolation
- `remove_worktree()` - Remove worktree
- `prune_worktrees()` - Clean up stale worktrees
- `list_worktrees()` - Get all worktrees for repo

**Branch Operations:**
- `create_branch()` - Create new branch
- `checkout()` - Switch to branch
- `delete_branch()` - Delete branch (local/remote)
- `list_branches()` - List all branches
- `current_branch()` - Get active branch name
- `set_upstream()` - Set tracking branch

**Commit Operations:**
- `commit()` - Create commit with message
- `amend()` - Amend last commit
- `reset()` - Reset to commit
- `log()` - Get commit history
- `show()` - Show commit details

**Remote Operations:**
- `fetch()` - Fetch from remote
- `pull()` - Pull from remote
- `push()` - Push to remote
- `add_remote()` - Add remote repository
- `list_remotes()` - Get all remotes

**Diff Operations:**
- `diff()` - Get diff between refs
- `diff_stats()` - Get diff statistics
- `diff_files()` - Get changed files list
- `staged_files()` - Get staged files
- `unstaged_files()` - Get unstaged files

**Status Operations:**
- `status()` - Get repository status
- `is_clean()` - Check if working directory is clean
- `has_uncommitted_changes()` - Check for uncommitted changes
- `untracked_files()` - Get untracked files

**Merge Operations:**
- `merge()` - Merge branch
- `merge_base()` - Find merge base
- `has_merge_conflicts()` - Check for conflicts
- `abort_merge()` - Abort ongoing merge

**Advanced Operations:**
- `cherry_pick()` - Cherry-pick commit
- `rebase()` - Rebase branch
- `stash()` - Stash changes
- `apply_stash()` - Apply stashed changes
- `tag()` - Create tag
- `describe()` - Describe commit with tags

**Config & Info:**
- `config_get()` - Get git config value
- `config_set()` - Set git config value
- `get_repo_root()` - Find repository root
- `rev_parse()` - Resolve git reference

**Submodules & LFS:**
- `init_submodules()` - Initialize submodules
- `update_submodules()` - Update submodules
- `lfs_pull()` - Pull LFS objects
- `lfs_fetch()` - Fetch LFS objects

### EventService (`services/src/events.ts`)

**Core:**
- `EventService` class - Real-time event streaming service
- `subscribe()` - Subscribe to event streams
- `publish()` - Publish events to subscribers
- `msg_store()` - Access underlying message store

**Event Types:**
- Execution process events
- Workspace events
- Task events
- Approval events
- Log events

**Streaming:**
- Server-Sent Events (SSE) support
- WebSocket support
- Event filtering by type
- Per-session event streams
- Per-workspace event streams

### NotificationService (`services/src/notification.ts`)

**Core:**
- `NotificationService` class
- `send()` - Send notification (OS-native)
- `send_task_complete()` - Task completion notification
- `send_approval_request()` - Approval needed notification

**Platform Support:**
- Windows toast notifications
- macOS notification center
- Linux notification daemon

### ProjectService (`services/src/project.ts`)

**Currently has basic stubs, missing:**
- `create_project()` - Project creation logic
- `delete_project()` - Project deletion with cleanup
- `list_active_projects()` - Get projects with recent activity
- `get_project_statistics()` - Project stats (tasks, workspaces, etc.)

### FilesystemService (`services/src/filesystem.ts`)

**Missing Operations:**
- `delete_file()` - Delete file
- `delete_directory()` - Delete directory recursively
- `move_file()` - Move/rename file
- `copy_file()` - Copy file
- `create_directory()` - Create directory
- `watch_file()` - Watch file for changes
- `watch_directory()` - Watch directory for changes
- `get_file_metadata()` - Get detailed file metadata
- `search_files()` - Search files by pattern
- `read_binary_file()` - Read binary file
- `write_binary_file()` - Write binary file

### ConfigService (`services/src/config.ts`)

**Missing:**
- `load_from_file()` - Load config from disk
- `save_to_file()` - Persist config to disk
- `validate()` - Validate configuration
- `merge()` - Merge configuration objects
- `get_user_config()` - User-specific config
- `get_workspace_config()` - Workspace-specific config
- `watch_changes()` - Watch for config file changes
- Config versioning and migration

### Additional Missing Services

**RepoService:**
- Repository CRUD operations
- Repository validation
- Default branch detection
- Repository scanning

**ImageService:**
- Image upload handling
- Image storage management
- Image serving
- Thumbnail generation
- Image metadata extraction

**AnalyticsService:**
- Event tracking
- User identification
- Telemetry collection
- Analytics opt-in/opt-out

**ApprovalService:**
- Approval request creation
- Approval response handling
- Approval state management
- Approval notifications

**QueuedMessageService:**
- Message queuing for follow-ups
- Queue persistence
- Message retrieval
- Queue cleanup

**WorkspaceManager:**
- Workspace lifecycle management
- Workspace state tracking
- Workspace cleanup
- Container reference management

**WorktreeManager:**
- Worktree creation
- Worktree cleanup
- Worktree path resolution
- Multi-repo worktree coordination

**PrMonitorService:**
- Pull request monitoring
- PR status updates
- PR merge detection
- PR comment handling

**FileSearchCache:**
- Code search indexing
- Search result caching
- Cache invalidation
- Multi-repo search

**GitHubService:**
- GitHub API integration
- PR creation
- Issue linking
- Repository operations

---

## @orchestrator/local-deployment

### LocalContainerService (`local-deployment/src/container.ts`)

**Completely Missing - Core Implementation:**
- `LocalContainerService` class
- Process spawning with child_process/node-pty
- Execution monitoring and lifecycle management

**Critical Orchestration:**
- `spawn_exit_monitor()` - **Core orchestration logic**
  - Monitor child process completion
  - Check for queued follow-up messages
  - Start next action in chain
  - Auto-commit uncommitted changes
  - Finalize task on completion
  - Fire analytics events
  - Sync to remote (cloud)

**Execution Management:**
- `start_execution_inner()` - Spawn actual process
- `stop_execution_inner()` - Kill running process
- `get_running_child()` - Get active child process handle
- `cleanup_workspace()` - Clean up workspace resources

**Approval Integration:**
- `ExecutorApprovalBridge` - Bridge approval service to executors
- Approval request forwarding
- Approval response handling

**Queued Messages:**
- `start_queued_follow_up()` - Execute queued follow-up messages
- Check for and retrieve queued messages on completion

**Worktree Management:**
- Create git worktrees for workspace isolation
- Setup multi-repo worktrees
- Copy files between repos
- Cleanup worktrees on deletion

**Auto-commit:**
- Detect uncommitted changes
- Auto-commit before cleanup scripts
- Configurable auto-commit behavior

**Container References:**
- Map workspace ID to filesystem path
- Manage container reference lifecycle
- Path resolution for worktrees

---

## @orchestrator/executors

### Base Executor Infrastructure (`executors/src/base.ts`)

**Missing:**
- `StandardCodingAgentExecutor` interface
- `ExecutorError` type and error handling
- `SpawnedChild` type for process management
- `ExecutionEnv` - Environment variables and config
- `MsgStore` integration for log streaming

### Executor Implementations

**ClaudeCode (`executors/src/claude.ts`):**
- Session management and resumption
- `spawn()` - Initial execution
- `spawn_follow_up()` - Follow-up with session ID
- `normalize_logs()` - Parse Claude's JSON output format
- Session ID extraction from logs
- Message UUID tracking for --resume-session-at
- Slash command discovery
- MCP (Model Context Protocol) integration
- Plugin discovery
- Command builder with version detection

**Cursor (`executors/src/cursor.ts`):**
- Cursor-specific setup helpers
- Integration with Cursor's CLI
- Session handling

**Codex (`executors/src/codex.ts`):**
- OpenAI Codex integration
- Session management
- Conversation history tracking
- Setup helper actions

**Gemini (`executors/src/gemini.ts`):**
- Google Gemini integration
- API key management
- Session handling

**QwenCode:**
- Alibaba Qwen Code integration
- Model selection
- Session management

**AMP:**
- AMP agent integration
- Oracle tool support
- Mermaid diagram support
- Codebase search agent

**Droid:**
- Droid agent integration
- Session forking
- JSONL session file handling

**OpenCode:**
- OpenCode integration
- Auto-approve mode
- Auto-compact mode
- Model configuration

### Action Implementations (`executors/src/actions/`)

**CodingAgentInitialRequest:**
- Initial prompt execution
- Executor selection
- Working directory handling
- Environment setup
- Process spawning

**CodingAgentFollowUpRequest:**
- Follow-up prompt with session ID
- Session continuity
- Reset to message ID support
- Working directory resolution

**ReviewRequest:**
- Code review prompt generation
- Context gathering
- Session handling
- Review-specific configuration

**ScriptRequest:**
- Script execution (bash/powershell)
- Script context (setup/cleanup/archive/devserver)
- Working directory handling
- Environment variable passing

### Executor Features

**Log Normalization:**
- Parse executor-specific output formats
- Convert to normalized entries
- Extract session IDs
- Track message UUIDs
- Handle streaming content

**Approval Workflows:**
- Approval request generation
- Approval response handling
- Auto-approve mode
- Tool call approvals

**Session Management:**
- Session creation
- Session resumption
- Session forking
- Session file persistence

**Environment Handling:**
- Repository context
- Working directory resolution
- Environment variables
- Commit reminders
- Permission settings

**MCP Integration:**
- MCP server configuration
- Server discovery
- Tool availability
- Protocol handling

**Slash Commands:**
- Command discovery
- Dynamic command loading
- Command documentation
- Command execution

---

## @orchestrator/server

### Route Implementations

**ExecutionProcesses (`server/src/routes/execution-processes.ts`):**
- WebSocket log streaming (raw logs)
- WebSocket log streaming (normalized logs)
- Start execution endpoint
- Stop execution endpoint
- Get execution status
- List executions by session
- List executions by workspace
- Execution process repository states
- Real-time log updates via WebSocket
- Proper database integration

**TaskAttempts (`server/src/routes/task-attempts.ts`):**
- Create workspace
- Start workspace execution
- Run setup script
- Run cleanup script
- Run agent setup (Cursor/Codex helpers)
- Start dev server
- Stop dev server
- Create pull request
- Merge branch
- Restore workspace state
- Duplicate workspace
- Archive workspace
- Database integration for all operations

**Approvals (`server/src/routes/approvals.ts`):**
- Create approval request
- Respond to approval
- List pending approvals
- Get approval by ID
- Approval notifications
- Approval timeout handling

**Filesystem (`server/src/routes/filesystem.ts`):**
- Read file
- Write file
- List directory
- Create directory
- Delete file/directory
- Search files
- Get file metadata
- Watch file changes

**Images (`server/src/routes/images.ts`):**
- Upload image
- Serve image
- Delete image
- List images by task
- Image metadata
- Thumbnail generation

**Scratch (`server/src/routes/scratch.ts`):**
- Create scratch item
- Update scratch item
- Delete scratch item
- Get scratch item
- List scratch items by type
- Database persistence

**Search (`server/src/routes/search.ts`):**
- Multi-repo code search
- File search
- Symbol search
- Search result ranking
- Search caching

**Terminal (`server/src/routes/terminal.ts`):**
- WebSocket terminal connection
- PTY creation
- Terminal input handling
- Terminal resize handling
- Terminal session management

**OAuth (`server/src/routes/oauth.ts`):**
- OAuth flow initiation
- OAuth callback handling
- Token storage
- Token refresh
- Provider-specific implementations

**Sessions (`server/src/routes/sessions.ts`):**
- Queue message for follow-up
- Get session messages
- Pause/resume session
- Database integration (currently in-memory)

**Projects (`server/src/routes/projects.ts`):**
- Database integration (currently in-memory)
- Project statistics
- Project-repo associations

**Tasks (`server/src/routes/tasks.ts`):**
- Database integration (currently in-memory)
- Task-workspace associations
- Task status tracking
- Task images

**Containers (`server/src/routes/containers.ts`):**
- Database integration (currently in-memory)
- Container lifecycle management
- Container info retrieval
- Workspace context

**Events (`server/src/routes/events.ts`):**
- Server-Sent Events implementation
- Event subscription
- Event filtering
- Real-time updates

---

## @orchestrator/deployment

### Deployment Interface (`deployment/src/index.ts`)

**Missing Methods:**
- `file_search_cache()` - Access to search cache
- `approvals()` - Access to approval service
- `queued_message_service()` - Access to message queue
- `auth_context()` - Authentication context
- `repo()` - Repository service
- `image()` - Image service
- `filesystem()` - Filesystem service
- `events()` - Event service
- `analytics()` - Analytics service

---

## @orchestrator/utils

### Missing Utilities

**MsgStore (`utils/src/msg-store.ts`):**
- In-memory message storage for log streaming
- History tracking
- Stream creation
- Message pushing
- Session ID tracking
- Entry index management

**LogMsg (`utils/src/log-msg.ts`):**
- Log message types (Stdout, Stderr, JsonPatch, Finished)
- Message serialization
- WebSocket message conversion

**Exit Signals:**
- Process exit signal handling
- Signal passing between parent/child processes
- Exit code tracking

**Text Utilities:**
- `git_branch_id()` - Sanitize text for git branch names
- `short_uuid()` - Generate short UUID prefixes
- `truncate_text()` - Smart text truncation

**Stdout Duplication:**
- Create pipe for stdout duplication
- Send stdout to multiple destinations
- Handle child process stdout

---

## Priority Implementation Order

### Critical Path (Required for Basic Functionality):

1. **LocalContainerService** - Core execution engine
2. **spawn_exit_monitor** - Orchestration brain
3. **start_execution / start_workspace** - Execution lifecycle
4. **GitService** - Basic operations (worktree, commit, branch)
5. **ExecutionProcess routes** - WebSocket log streaming
6. **Database integration** - All in-memory routes

### High Priority (Core Features):

7. **Executor implementations** - Claude, Cursor, Codex
8. **Action implementations** - Initial, FollowUp, Script
9. **Log normalization** - Parse executor outputs
10. **TaskAttempt routes** - Workspace management
11. **EventService** - Real-time updates

### Medium Priority (Enhanced Functionality):

12. **Approval workflows** - Approval routes + service
13. **GitService advanced** - Full git operations
14. **Filesystem routes** - File operations
15. **Search implementation** - Code search
16. **Image handling** - Upload/serve

### Low Priority (Nice to Have):

17. **Additional executors** - QwenCode, AMP, Droid, OpenCode
18. **Analytics** - Telemetry
19. **OAuth** - Third-party auth
20. **Terminal** - WebSocket terminal

---

## Notes

- The TypeScript translation is currently at ~15% completion
- Most routes are in-memory stubs that need database integration
- The critical orchestration logic (spawn_exit_monitor) is completely missing
- Executor implementations are minimal stubs
- Log streaming infrastructure is not implemented
- Git operations are completely missing

This document will be updated as functionality is implemented.

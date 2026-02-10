# Frontend Integrations Documentation

## Overview

The frontend is a **React 18 + TypeScript** application built with **Vite**, using **TanStack Query** for server state, **Zustand** for client state, and **Electric** for real-time database sync. It communicates with the backend exclusively through a REST API and WebSocket connections.

---

## 1. Backend API

**Client:** [`frontend/src/lib/api.ts`](frontend/src/lib/api.ts) — uses native `fetch`, no external HTTP library.

**Base URL:**
- Dev: Vite proxy forwards `/api` → `http://localhost:${BACKEND_PORT:-3001}`
- Production: Same origin (relative `/api` paths)

### API Modules

| Module | Prefix | Key Operations |
|--------|--------|----------------|
| `projectsApi` | `/api/projects` | CRUD, open editor, search files, manage repositories |
| `tasksApi` | `/api/tasks` | CRUD, create-and-start |
| `sessionsApi` | `/api/sessions` | CRUD, follow-up messages, start review |
| `attemptsApi` | `/api/task-attempts` | CRUD, git ops (push/rebase/merge), PR creation, dev server, branch management, image upload |
| `executionProcessesApi` | `/api/execution-processes` | Get details, repo states, stop process |
| `repoApi` | `/api/repos` | CRUD, branches, remotes, open PRs, search files |
| `configApi` | `/api/info`, `/api/config` | System info, save config, check editor/agent availability |
| `tagsApi` | `/api/tags` | CRUD |
| `imagesApi` | `/api/images` | Upload, delete, get by task/attempt |
| `approvalsApi` | `/api/approvals` | Respond to agent approval requests |
| `oauthApi` | `/api/auth` | OAuth handoff, status, logout, token, current user |
| `organizationsApi` | `/api/organizations` | CRUD, members, invitations, roles |
| `fileSystemApi` | `/api/filesystem` | List directories, discover git repos |
| `mcpServersApi` | `/api/mcp-config` | Load/save MCP server configuration |
| `profilesApi` | `/api/profiles` | Load/save executor profiles |
| `scratchApi` | `/api/scratch` | CRUD for scratch/notes data |
| `queueApi` | `/api/sessions/{id}/queue` | Queue/cancel/status for follow-up messages |
| `searchApi` | `/api/search` | Multi-repo file search |
| `migrationApi` | `/api/migration` | Start workspace migration |
| `agentsApi` | `/api/agents` | Slash commands WebSocket URL |
| `remoteApi` | `VITE_VK_SHARED_API_BASE` | Bulk update issues/project statuses on remote server |

### Error Handling

- Custom `ApiError` class with status code, message, and endpoint
- Two response patterns:
  - `handleApiResponse<T>()` — throws on error
  - `handleApiResponseAsResult<T, E>()` — returns `{success, data, error}`
- All errors logged with timestamp and endpoint context

---

## 2. WebSocket / Real-Time Streams

All WebSocket connections use automatic reconnection with exponential backoff (1s → 2s → 4s → 8s max).

| Stream | Endpoint | Protocol | Purpose |
|--------|----------|----------|---------|
| **Log Stream** | `/api/execution-processes/{id}/raw-logs/ws` | JSON (stdout/stderr entries) | Stream agent execution logs |
| **Execution Processes** | `/api/sessions/{id}/execution-processes/stream/ws` | JSON Patch (RFC 6902) | Real-time process state updates |
| **Project Tasks** | `/api/projects/{id}/tasks/stream/ws` | JSON Patch | Live task list for a project |
| **Projects** | `/api/projects/stream/ws` | JSON Patch | Live projects list |
| **Terminal** | `/api/execution-processes/{id}/terminal/ws` | Raw text | Interactive terminal I/O |
| **Scratch** | `/api/scratch/{type}/{id}/stream/ws` | JSON Patch | Real-time notes/scratch updates |
| **Slash Commands** | `/api/agents/slash-commands/ws` | WebSocket | Agent slash command suggestions |

**Key hooks:**
- `useLogStream(processId)` — raw log streaming
- `useJsonPatchWsStream(endpoint)` — generic JSON Patch state sync
- `useExecutionProcesses(sessionId)` — process state
- `useProjectTasks(projectId)` — task state
- `useProjects()` — project state

---

## 3. Database (Electric Sync)

**Library:** `@tanstack/electric-db-collection` + `@tanstack/react-db`

The frontend syncs with a **remote PostgreSQL database** via Electric's HTTP polling and WebSocket protocol. This powers the collaborative/multi-user features.

### Synced Entities

| Entity | Scope | Context Provider |
|--------|-------|------------------|
| Projects | Organization | `OrgContext` |
| Notifications | User | `OrgContext` |
| Issues | Project | `ProjectContext` |
| Issue Statuses | Project | `ProjectContext` |

### How It Works

1. Electric shapes define what data to sync for each entity
2. `useEntity()` hook provides `{data, insert, update, remove}` with **optimistic UI**
3. Client-side inserts generate UUIDs locally
4. Changes sync bidirectionally — local writes are optimistic, confirmed by server
5. Conflict resolution is automatic
6. On auth token refresh, all shapes pause/resume to avoid stale data

### Local Cache

Uses **wa-sqlite** for client-side SQLite caching and offline support.

---

## 4. Authentication

**Token Manager:** [`frontend/src/lib/auth/tokenManager.ts`](frontend/src/lib/auth/tokenManager.ts) — singleton managing OAuth token lifecycle.

### Flow

```
1. oauthApi.handoffInit(provider, returnTo)  →  POST /api/auth/handoff/init
   Returns: { handoff_id, authorize_url }

2. User redirected to external OAuth provider

3. oauthApi.status()                          →  GET /api/auth/status
   Returns: { authenticated, user_id }

4. oauthApi.getToken()                        →  GET /api/auth/token
   Returns: { access_token, expires_in }

5. oauthApi.getCurrentUser()                  →  GET /api/auth/user
```

### Token Refresh

- Tokens cached with 125-second stale time via React Query
- On 401 response, `triggerRefresh()` deduplicates concurrent refresh requests
- During refresh, Electric shapes pause to prevent auth errors
- Hook: `useAuth()` returns `{isSignedIn, isLoaded, userId}`

---

## 5. State Management

### Layers

| Layer | Library | Purpose |
|-------|---------|---------|
| Server state | TanStack Query | API data caching, refetching, mutations |
| Client state | Zustand | UI preferences, panel states, filters |
| Shared state | React Context | Auth, theme, search, terminal, project scope |
| Synced state | Electric + TanStack DB | Collaborative data (issues, projects) |

### Zustand Stores

- **`useUiPreferencesStore`** — panel modes, kanban filters, layout, accordion states. Persisted to server via scratch API.
- **`useDiffViewStore`** — diff viewer preferences
- **`useTaskDetailsUiStore`** — task detail panel state
- **`useOrganizationStore`** — selected organization
- **`useExpandableStore`** — collapsible section states

### Key Context Providers

| Provider | Scope | Data |
|----------|-------|------|
| `UserSystemProvider` | App | Config, auth, profiles, capabilities |
| `OrgContext` | Organization | Projects, notifications (Electric-synced) |
| `ProjectContext` | Project | Issues, statuses (Electric-synced) |
| `ThemeProvider` | App | Light/dark theme |
| `TerminalProvider` | Workspace | Terminal WebSocket connections |
| `SearchProvider` | App | Global search state |
| `SyncErrorContext` | App | Electric sync error aggregation |

---

## 6. Third-Party Services

### Sentry (Error Tracking)

- **Setup:** [`frontend/src/main.tsx`](frontend/src/main.tsx)
- React Router v6 tracing integration
- 100% trace sample rate
- Error boundary wraps entire app

### PostHog (Product Analytics)

- **Config:** `VITE_POSTHOG_API_KEY` + `VITE_POSTHOG_API_ENDPOINT`
- Tracks: page views, page leave, performance
- Autocapture: disabled
- Respects user's `analytics_enabled` config setting

---

## 7. GitHub Integration

| Feature | API Call | Endpoint |
|---------|----------|----------|
| List open PRs | `repoApi.listOpenPrs()` | GET `/api/repos/{id}/prs` |
| Create PR | `attemptsApi.createPR()` | POST `/api/task-attempts/{id}/pr` |
| Get PR comments | `attemptsApi.getPrComments()` | GET `/api/task-attempts/{id}/pr/comments` |
| Setup GitHub CLI | `attemptsApi.setupGhCli()` | POST `/api/task-attempts/{id}/gh-cli-setup` |
| Create workspace from PR | `attemptsApi.createFromPr()` | POST `/api/task-attempts/from-pr` |

---

## 8. Internationalization

**Framework:** i18next + react-i18next

**Supported languages:** English, French, Japanese, Spanish, Korean, Chinese (Simplified + Traditional)

**Resource bundles:** `common`, `settings`, `projects`, `tasks`, `organization`

Language auto-detected from browser, switchable via settings. Config synced from `UserSystemProvider`.

---

## 9. Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITE_VK_SHARED_API_BASE` | Remote API base URL |
| `VITE_POSTHOG_API_KEY` | PostHog analytics key |
| `VITE_POSTHOG_API_ENDPOINT` | PostHog endpoint |
| `VITE_PUBLIC_REACT_VIRTUOSO_LICENSE_KEY` | Virtual scroll license |
| `VITE_PARENT_ORIGIN` | Cross-origin parent communication |
| `VITE_API_PROXY_TARGET` | Dev proxy target override |
| `FRONTEND_PORT` | Dev server port (default: 3000) |
| `BACKEND_PORT` | Backend port for proxy (default: 3001) |

---

## 10. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐             │
│  │ Zustand   │  │ TanStack │  │  Electric │             │
│  │ (UI State)│  │  Query   │  │  (DB Sync)│             │
│  └──────────┘  └────┬─────┘  └─────┬─────┘             │
│                      │              │                    │
│                ┌─────┴──────────────┴──────┐            │
│                │     lib/api.ts (fetch)     │            │
│                └─────┬──────────────┬──────┘            │
│                      │              │                    │
│               REST API         WebSockets                │
└──────────────────────┼──────────────┼────────────────────┘
                       │              │
                       ▼              ▼
              ┌────────────────────────────┐
              │      Backend (Port 3001)    │
              │                            │
              │  ┌──────────────────────┐  │
              │  │    PostgreSQL DB     │  │
              │  └──────────────────────┘  │
              └────────────────────────────┘
                       │
              ┌────────┴────────┐
              │  External APIs   │
              │  - GitHub        │
              │  - OAuth Provider│
              │  - Sentry        │
              │  - PostHog       │
              └─────────────────┘
```

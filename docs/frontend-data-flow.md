# Frontend Data Flow Architecture

This document explains how Vibe Kanban's frontend manages real-time data synchronization using TanStack Query, TanStack DB with Electric, WebSockets, and REST APIs.

## Table of Contents

- [Overview](#overview)
- [TanStack Query](#tanstack-query)
- [TanStack DB with Electric](#tanstack-db-with-electric)
- [WebSocket Streaming](#websocket-streaming)
- [REST API Calls](#rest-api-calls)
- [When to Use What](#when-to-use-what)

## Overview

The frontend employs a sophisticated data fetching architecture that combines multiple technologies to provide real-time updates and optimal user experience:

1. **TanStack Query** - For server state management, caching, and traditional REST API calls
2. **TanStack DB + Electric** - For real-time data sync with the remote backend (cloud features)
3. **WebSocket Streams** - For real-time streaming of live process data using JSON Patch
4. **REST APIs** - For one-time operations and mutations

## TanStack Query

**Location**: Configured in [`frontend/src/main.tsx`](../frontend/src/main.tsx)

### Setup

```typescript
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      console.error('[React Query Error]', {
        queryKey: query.queryKey,
        error: error,
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});
```

### Use Cases

TanStack Query is used for:

1. **Traditional Data Fetching** - One-time data loads that don't need real-time updates
2. **Cache Management** - Automatic caching with configurable staleness
3. **Query Invalidation** - Coordinating updates across multiple components

### Example: Fetching a Task

**File**: [`frontend/src/hooks/useTask.ts`](../frontend/src/hooks/useTask.ts)

```typescript
import { useQuery } from '@tanstack/react-query';
import { tasksApi } from '@/lib/api';

export const taskKeys = {
  all: ['tasks'] as const,
  byId: (taskId: string | undefined) => ['tasks', taskId] as const,
};

export function useTask(taskId?: string, opts?: Options) {
  return useQuery<Task>({
    queryKey: taskKeys.byId(taskId),
    queryFn: () => tasksApi.getById(taskId!),
    enabled: !!taskId,
  });
}
```

### Example: Mutations with Cache Invalidation

**File**: [`frontend/src/hooks/useCreateWorkspace.ts`](../frontend/src/hooks/useCreateWorkspace.ts)

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  
  const createWorkspace = useMutation({
    mutationFn: async ({ data }: CreateWorkspaceParams) => {
      const task = await tasksApi.createAndStart(data);
      const workspaces = await attemptsApi.getAll(task.id);
      return { task, workspaceId: workspaces[0]?.id };
    },
    onSuccess: ({ task, workspaceId }) => {
      // Invalidate related queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: workspaceSummaryKeys.all });
      
      if (task.parent_workspace_id) {
        queryClient.invalidateQueries({
          queryKey: taskRelationshipsKeys.byAttempt(task.parent_workspace_id),
        });
      }
    },
  });
  
  return { createWorkspace };
}
```

### Query Key Pattern

Query keys are organized hierarchically using factory functions for consistency:

```typescript
export const taskKeys = {
  all: ['tasks'] as const,
  byId: (taskId: string) => ['tasks', taskId] as const,
};

export const attemptKeys = {
  all: ['attempts'] as const,
  byId: (attemptId: string) => ['attempts', attemptId] as const,
};
```

This pattern enables:
- Precise cache invalidation (e.g., `invalidateQueries({ queryKey: taskKeys.all })`)
- Type-safe query keys
- Easy debugging and tracking

## TanStack DB with Electric

**Location**: [`frontend/src/lib/electric/`](../frontend/src/lib/electric/)

### What is Electric?

Electric is a real-time sync engine that provides instant data synchronization between client and server. It's used exclusively for the **remote/cloud features** where multiple users collaborate on shared data.

### Architecture

Electric uses a shape-based subscription model:

1. **Shape Subscription** - Client subscribes to a "shape" (filtered view) of data
2. **Initial Sync** - Server sends current snapshot
3. **Live Updates** - Server pushes incremental changes as they occur
4. **Optimistic Updates** - Client updates immediately, server confirms/rejects

### Setup

**File**: [`frontend/src/lib/electric/collections.ts`](../frontend/src/lib/electric/collections.ts)

```typescript
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import { createCollection } from '@tanstack/react-db';

function getAuthenticatedShapeOptions(shape, params, config) {
  const url = buildUrl(shape.url, params);
  
  return electricCollectionOptions({
    url: `${REMOTE_API_URL}${url}`,
    headers: async () => {
      const token = await tokenManager.getAccessToken();
      return { Authorization: `Bearer ${token}` };
    },
    fetchClient: createErrorHandlingFetch(errorHandler, onError),
  });
}
```

### Custom Hook: useEntity

**File**: [`frontend/src/lib/electric/hooks.ts`](../frontend/src/lib/electric/hooks.ts)

The `useEntity` hook provides a unified interface for Electric sync + optimistic mutations:

```typescript
export function useEntity<E extends EntityDefinition>(
  entity: E,
  params: Record<string, string>,
  options?: UseEntityOptions
): UseEntityResult<TRow, TCreate, TUpdate> {
  // Setup Electric collection with live sync
  const collection = createEntityCollection(entity, params, config);
  
  // Subscribe to live changes
  const { data, isLoading } = useLiveQuery(collection);
  
  return {
    data,
    isLoading,
    error,
    retry,
    insert: (data) => {
      // Optimistic insert - instantly visible in UI
      const result = collection.insert(data);
      // API call happens in background, confirmed by Electric sync
      return result;
    },
    update: (id, changes) => {
      // Optimistic update - instant UI change
      const result = collection.update(id, changes);
      return result;
    },
    remove: (id) => {
      // Optimistic removal
      return collection.remove(id);
    },
  };
}
```

### Example: Organization Context

**File**: [`frontend/src/contexts/remote/OrgContext.tsx`](../frontend/src/contexts/remote/OrgContext.tsx)

```typescript
import { useEntity } from '@/lib/electric/hooks';
import { PROJECT_ENTITY, NOTIFICATION_ENTITY } from 'shared/remote-types';

export function OrgProvider({ organizationId, children }) {
  const params = { organization_id: organizationId };
  
  // Real-time sync of projects
  const projectsResult = useEntity(PROJECT_ENTITY, params, { enabled: true });
  
  // Real-time sync of notifications
  const notificationsResult = useEntity(NOTIFICATION_ENTITY, params, { enabled: true });
  
  // Mutations are optimistic - instant UI updates
  const insertProject = (data) => projectsResult.insert(data);
  const updateProject = (id, changes) => projectsResult.update(id, changes);
  
  return (
    <OrgContext.Provider value={{
      projects: projectsResult.data,
      isLoading: projectsResult.isLoading,
      insertProject,
      updateProject,
    }}>
      {children}
    </OrgContext.Provider>
  );
}
```

### Why Use Electric?

Electric is used for remote/cloud features because:
- **Multi-user collaboration** - Multiple users need to see each other's changes instantly
- **Offline support** - Works offline, syncs when reconnected
- **Optimistic UI** - Instant feedback, no loading spinners for mutations
- **Reduced API calls** - One persistent connection instead of polling

### Entities Synced via Electric

Located in [`shared/remote-types.ts`](../shared/remote-types.ts):

- **Projects** - Cloud projects shared across organization
- **Issues** - Task tracking items
- **Notifications** - User notifications
- **Issue Comments** - Threaded discussions
- **Pull Requests** - GitHub PR integration data
- **Tags** - Issue categorization
- **Workspaces** - Remote workspace metadata

## WebSocket Streaming

**Location**: [`frontend/src/hooks/useJsonPatchWsStream.ts`](../frontend/src/hooks/useJsonPatchWsStream.ts)

### Overview

WebSockets provide **real-time streaming** of live execution data using JSON Patch operations. Unlike Electric (which syncs persisted database state), WebSocket streams deliver ephemeral process data.

### Why WebSockets?

WebSockets are used when:
1. **Real-time process output** - Streaming logs, diffs, execution status
2. **High-frequency updates** - Process state changes happen rapidly
3. **Ephemeral data** - Data that doesn't need to be persisted long-term
4. **JSON Patch streaming** - Efficient incremental updates

### Core Pattern: JSON Patch Streaming

The backend sends JSON Patch operations to incrementally update client-side state:

```typescript
// Server sends:
{
  "JsonPatch": [
    { "op": "add", "path": "/tasks/123", "value": { /* task data */ } },
    { "op": "replace", "path": "/tasks/123/status", "value": "inprogress" }
  ]
}

// Or completion signal:
{ "finished": true }

// Or ready signal (initial data loaded):
{ "Ready": true }
```

### Generic Hook: useJsonPatchWsStream

**File**: [`frontend/src/hooks/useJsonPatchWsStream.ts`](../frontend/src/hooks/useJsonPatchWsStream.ts)

```typescript
export const useJsonPatchWsStream = <T extends object>(
  endpoint: string | undefined,
  enabled: boolean,
  initialData: () => T,
  options?: UseJsonPatchStreamOptions<T>
): UseJsonPatchStreamResult<T> => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  useEffect(() => {
    if (!enabled || !endpoint) return;
    
    // Initialize data structure
    const currentData = initialData();
    
    // Connect WebSocket
    const wsEndpoint = endpoint.replace(/^http/, 'ws');
    const ws = new WebSocket(wsEndpoint);
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      // Handle JSON Patch operations
      if ('JsonPatch' in msg) {
        const patches = msg.JsonPatch;
        
        // Apply patches using Immer for structural sharing
        const next = produce(currentData, (draft) => {
          applyUpsertPatch(draft, patches);
        });
        
        setData(next);
      }
      
      // Handle ready signal
      if ('Ready' in msg) {
        setIsInitialized(true);
      }
      
      // Handle completion
      if ('finished' in msg) {
        ws.close();
      }
    };
    
    // Automatic reconnection with exponential backoff
    ws.onclose = () => {
      if (!finishedRef.current) {
        scheduleReconnect(); // Retry with backoff
      }
    };
    
    return () => ws.close();
  }, [endpoint, enabled]);
  
  return { data, isConnected, isInitialized, error };
};
```

### Key Features

1. **Structural Sharing** - Uses Immer to only update changed parts of state
2. **Automatic Reconnection** - Exponential backoff retry on connection loss
3. **Lifecycle Management** - Handles connection, initialization, and completion states
4. **Type Safety** - Generic type parameter for compile-time safety

### Example: Streaming Project Tasks

**File**: [`frontend/src/hooks/useProjectTasks.ts`](../frontend/src/hooks/useProjectTasks.ts)

```typescript
import { useJsonPatchWsStream } from './useJsonPatchWsStream';

type TasksState = {
  tasks: Record<string, TaskWithAttemptStatus>;
};

export const useProjectTasks = (projectId: string) => {
  const endpoint = `/api/tasks/stream/ws?project_id=${encodeURIComponent(projectId)}`;
  
  const initialData = useCallback(
    (): TasksState => ({ tasks: {} }),
    []
  );
  
  const { data, isConnected, isInitialized, error } = useJsonPatchWsStream(
    endpoint,
    !!projectId,
    initialData
  );
  
  // Transform to array for rendering
  const tasks = useMemo(
    () => Object.values(data?.tasks ?? {}),
    [data?.tasks]
  );
  
  return { tasks, isLoading: !isInitialized, error };
};
```

The server sends incremental updates:

```typescript
// Initial snapshot
{ "JsonPatch": [
  { "op": "replace", "path": "/tasks", "value": {
    "task-1": { id: "task-1", title: "Fix bug", status: "todo" },
    "task-2": { id: "task-2", title: "Add feature", status: "inprogress" }
  }}
]}

// Task status change
{ "JsonPatch": [
  { "op": "replace", "path": "/tasks/task-1/status", "value": "inprogress" }
]}

// New task added
{ "JsonPatch": [
  { "op": "add", "path": "/tasks/task-3", "value": { 
    id: "task-3", 
    title: "Write docs", 
    status: "todo" 
  }}
]}
```

### Example: Streaming Execution Processes

**File**: [`frontend/src/hooks/useExecutionProcesses.ts`](../frontend/src/hooks/useExecutionProcesses.ts)

```typescript
export const useExecutionProcesses = (
  sessionId: string | undefined,
  opts?: { showSoftDeleted?: boolean }
) => {
  const params = new URLSearchParams({ session_id: sessionId });
  const endpoint = `/api/execution-processes/stream/session/ws?${params}`;
  
  const initialData = useCallback(
    (): ExecutionProcessState => ({ execution_processes: {} }),
    []
  );
  
  const { data, isConnected, isInitialized } = useJsonPatchWsStream(
    endpoint,
    !!sessionId,
    initialData
  );
  
  const executionProcesses = Object.values(data?.execution_processes ?? {});
  
  return {
    executionProcesses,
    isLoading: !isInitialized,
    isConnected,
  };
};
```

### Example: Streaming Diffs

**File**: [`frontend/src/hooks/useDiffStream.ts`](../frontend/src/hooks/useDiffStream.ts)

```typescript
export const useDiffStream = (
  attemptId: string | null,
  enabled: boolean,
  options?: { statsOnly?: boolean }
) => {
  const endpoint = (() => {
    if (!attemptId) return undefined;
    const query = `/api/task-attempts/${attemptId}/diff/ws`;
    if (options?.statsOnly) {
      return `${query}?stats_only=true`;
    }
    return query;
  })();
  
  const { data, error, isInitialized } = useJsonPatchWsStream(
    endpoint,
    enabled && !!attemptId,
    () => ({ entries: {} })
  );
  
  // Extract diffs from streamed entries
  const diffs = useMemo(() => {
    return Object.values(data?.entries ?? {})
      .filter((entry) => entry?.type === 'DIFF')
      .map((entry) => entry.content);
  }, [data?.entries]);
  
  return { diffs, error, isInitialized };
};
```

### Example: Streaming Logs

**File**: [`frontend/src/hooks/useLogStream.ts`](../frontend/src/hooks/useLogStream.ts)

Unlike the generic hook, log streaming uses a direct WebSocket implementation for simpler state management:

```typescript
export const useLogStream = (processId: string) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    if (!processId) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/execution-processes/${processId}/raw-logs/ws`
    );
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if ('JsonPatch' in data) {
        const patches = data.JsonPatch;
        patches.forEach((patch) => {
          const value = patch?.value;
          if (value?.type === 'STDOUT' || value?.type === 'STDERR') {
            setLogs((prev) => [...prev, { 
              type: value.type, 
              content: value.content 
            }]);
          }
        });
      }
    };
    
    return () => ws.close();
  }, [processId]);
  
  return { logs, error };
};
```

### When to Use WebSocket Streaming

Use WebSocket streaming for:
- **Live process execution** - Streaming stdout/stderr logs
- **Real-time diffs** - File changes as they happen
- **Execution process state** - Process lifecycle updates
- **Task status updates** - Kanban board real-time updates
- **High-frequency ephemeral data** - Data that changes rapidly but isn't persisted

### WebSocket vs Electric

| Feature | WebSocket (JSON Patch) | Electric |
|---------|------------------------|----------|
| **Use Case** | Ephemeral process data | Persisted database entities |
| **Data Type** | Logs, diffs, process state | Projects, tasks, users |
| **Persistence** | Temporary (session-scoped) | Permanent (database-backed) |
| **Reconnection** | Server replays full state | Automatic catch-up sync |
| **Multi-user** | Single user session | Multi-user collaboration |
| **Optimistic Updates** | No (read-only stream) | Yes (instant mutations) |

## REST API Calls

**Location**: [`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts)

### Overview

REST APIs are used for **one-time operations** and **mutations** that don't require real-time streaming or sync.

### API Client Pattern

All API calls use a consistent wrapper with error handling:

```typescript
export class ApiError<E = unknown> extends Error {
  public status?: number;
  public error_data?: E;
  
  constructor(message: string, statusCode?: number, response?: Response, error_data?: E) {
    super(message);
    this.name = 'ApiError';
    this.status = statusCode;
    this.error_data = error_data;
  }
}

const makeRequest = async (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  
  return fetch(url, { ...options, headers });
};

const handleApiResponse = async <T, E = T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const errorData = await response.json();
    throw new ApiError<E>(
      errorData.message || 'API request failed',
      response.status,
      response,
      errorData.error_data
    );
  }
  
  const result = await response.json();
  return result.data as T;
};
```

### Organized by Domain

APIs are organized into logical groupings:

```typescript
// Project Management
export const projectsApi = {
  create: async (data: CreateProject): Promise<Project> => {
    const response = await makeRequest('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Project>(response);
  },
  
  update: async (id: string, data: UpdateProject): Promise<Project> => {
    const response = await makeRequest(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Project>(response);
  },
  
  delete: async (id: string): Promise<void> => {
    const response = await makeRequest(`/api/projects/${id}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },
};

// Task Management
export const tasksApi = {
  getById: async (taskId: string): Promise<Task> => {
    const response = await makeRequest(`/api/tasks/${taskId}`);
    return handleApiResponse<Task>(response);
  },
  
  create: async (data: CreateTask): Promise<Task> => {
    const response = await makeRequest(`/api/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Task>(response);
  },
  
  createAndStart: async (data: CreateAndStartTaskRequest): Promise<Task> => {
    const response = await makeRequest(`/api/tasks/create-and-start`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Task>(response);
  },
};

// Sessions
export const sessionsApi = {
  create: async (data: { workspace_id: string }): Promise<Session> => {
    const response = await makeRequest('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Session>(response);
  },
};
```

### When to Use REST APIs

REST APIs are used for:
- **CRUD operations** - Create, read, update, delete entities
- **One-time queries** - Fetching data that doesn't need real-time updates
- **Mutations** - Actions that trigger server-side logic
- **File uploads** - Image/attachment uploads
- **Git operations** - Commits, pushes, merges
- **Authentication** - Login, token refresh

### Common Patterns

#### 1. Simple Fetch with TanStack Query

```typescript
// In hook
const { data, isLoading } = useQuery({
  queryKey: ['task', taskId],
  queryFn: () => tasksApi.getById(taskId),
});
```

#### 2. Mutation with Invalidation

```typescript
const mutation = useMutation({
  mutationFn: (data) => tasksApi.update(taskId, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  },
});
```

#### 3. File Upload

```typescript
export const imagesApi = {
  uploadSessionImage: async (sessionId: string, file: File): Promise<ImageResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch('/api/images/upload', {
      method: 'POST',
      body: formData, // No Content-Type header - browser sets with boundary
    });
    
    return handleApiResponse<ImageResponse>(response);
  },
};
```

#### 4. Typed Error Handling

```typescript
type GitOperationError = { type: 'conflict' | 'permission' | 'network' };

const result = await handleApiResponseAsResult<void, GitOperationError>(response);

if (!result.success) {
  if (result.error?.type === 'conflict') {
    // Handle conflict
  }
}
```

## When to Use What

### Decision Flow

```
Does it need REAL-TIME updates?
├─ Yes
│  ├─ Is it PERSISTED database data?
│  │  └─ Yes → Use TanStack DB + Electric
│  │     Examples: Projects, Issues, Notifications
│  │
│  └─ Is it EPHEMERAL process data?
│     └─ Yes → Use WebSocket streaming
│        Examples: Logs, Diffs, Process state
│
└─ No (one-time operation)
   └─ Use REST API + TanStack Query
      Examples: Mutations, File uploads, One-time queries
```

### Quick Reference Table

| Technology | Use Case | Examples | Key Benefits |
|------------|----------|----------|--------------|
| **TanStack Query** | Server state management, REST API caching | Task details, User profile | - Automatic caching<br>- Refetch strategies<br>- Loading states |
| **TanStack DB + Electric** | Real-time multi-user collaboration | Cloud projects, Issues, Notifications | - Instant updates<br>- Offline support<br>- Optimistic UI |
| **WebSocket JSON Patch** | Live process streaming | Logs, Diffs, Execution state | - Real-time updates<br>- Efficient patches<br>- Reconnection |
| **REST APIs** | One-time operations | CRUD, Mutations, Uploads | - Simple request/response<br>- Standardized<br>- Easy debugging |

### Real-World Examples

#### Kanban Board

- **Tasks list** → WebSocket streaming (`useProjectTasks`)
  - Real-time task status updates
  - New tasks appear instantly
  - Efficient JSON Patch updates

- **Task creation** → REST API + TanStack Query mutation
  - `POST /api/tasks/create-and-start`
  - Invalidates task cache after success

- **Task details modal** → REST API + TanStack Query
  - `GET /api/tasks/:id`
  - Cached for 5 minutes

#### Workspace Execution View

- **Execution processes** → WebSocket streaming (`useExecutionProcesses`)
  - Live process state updates
  - Real-time status changes

- **Process logs** → WebSocket streaming (`useLogStream`)
  - Streaming stdout/stderr
  - Real-time log appending

- **Diffs** → WebSocket streaming (`useDiffStream`)
  - File changes streamed as they happen
  - Efficient incremental updates

- **Git operations** → REST API
  - Commit, push, merge actions
  - One-time operations with result

#### Cloud Collaboration (Remote Features)

- **Project list** → TanStack DB + Electric (`useEntity`)
  - Multi-user sync
  - Instant project additions
  - Optimistic mutations

- **Issue tracking** → TanStack DB + Electric
  - Real-time issue updates
  - Collaborative editing
  - Offline-first

- **Comments** → TanStack DB + Electric
  - Live comment threads
  - Instant reactions
  - Multi-user presence

## Best Practices

### 1. Query Key Management

Always use factory functions for query keys:

```typescript
export const taskKeys = {
  all: ['tasks'] as const,
  byId: (id: string) => ['tasks', id] as const,
  byProject: (projectId: string) => ['tasks', 'project', projectId] as const,
};

// Usage
queryClient.invalidateQueries({ queryKey: taskKeys.all });
queryClient.invalidateQueries({ queryKey: taskKeys.byProject(projectId) });
```

### 2. Graceful Degradation

Always handle loading and error states:

```typescript
const { data, isLoading, error } = useProjectTasks(projectId);

if (isLoading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
return <TaskList tasks={data} />;
```

### 3. WebSocket Cleanup

Always clean up WebSocket connections:

```typescript
useEffect(() => {
  const ws = new WebSocket(url);
  
  return () => {
    ws.close(); // Critical: prevent memory leaks
  };
}, [url]);
```

### 4. Optimistic Updates

Use optimistic updates for instant feedback:

```typescript
// With Electric
const { insert } = useEntity(ISSUE_ENTITY, params);

const handleCreate = (data) => {
  const { data: newIssue, persisted } = insert(data);
  // newIssue is instantly visible in UI
  
  persisted.then((confirmed) => {
    // Server confirmed, UI already updated via Electric sync
  });
};
```

### 5. Error Boundaries

Wrap data-fetching components in error boundaries:

```tsx
<Sentry.ErrorBoundary fallback={<ErrorPage />}>
  <DataFetchingComponent />
</Sentry.ErrorBoundary>
```

## Summary

The frontend employs a multi-layered data fetching strategy:

- **TanStack Query** manages REST API state with intelligent caching
- **TanStack DB + Electric** provides real-time multi-user sync for cloud features
- **WebSocket streaming** delivers live process data with JSON Patch efficiency
- **REST APIs** handle one-time operations and mutations

This architecture provides:
- **Real-time updates** where needed
- **Efficient bandwidth usage** through incremental updates
- **Optimistic UI** for instant feedback
- **Offline support** for cloud features
- **Type safety** throughout the stack

Choose the right tool based on your data's lifecycle: persisted vs ephemeral, collaborative vs single-user, and real-time vs on-demand.

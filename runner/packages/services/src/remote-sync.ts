/**
 * Remote sync service
 * Translates: crates/services/src/services/remote_sync.rs
 *
 * Syncs workspace and PR data to the remote server.
 */

import type { API } from '@runner/utils';

import { RemoteClient, RemoteClientError } from './remote-client.js';

// ── DiffStats (forward reference - will be imported from diff-stream when translated) ──

export interface DiffStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

// ── Functions ──

/**
 * Syncs workspace data to the remote server.
 * First checks if the workspace exists on remote, then updates if it does.
 */
export async function syncWorkspaceToRemote(
  client: RemoteClient,
  workspaceId: string,
  name?: string | null,
  archived?: boolean,
  stats?: DiffStats,
): Promise<void> {
  // First check if workspace exists on remote
  try {
    const exists = await client.workspaceExists(workspaceId);
    if (!exists) {
      console.debug(
        `Workspace ${workspaceId} not found on remote, skipping sync`,
      );
      return;
    }
  } catch (err) {
    if (err instanceof RemoteClientError && err.code === 'auth') {
      console.debug(
        `Workspace ${workspaceId} sync skipped: not authenticated`,
      );
      return;
    }
    console.error(
      `Failed to check workspace ${workspaceId} existence on remote: ${err}`,
    );
    return;
  }

  // Workspace exists, proceed with update
  try {
    await client.updateWorkspace(
      workspaceId,
      name,
      archived,
      stats?.filesChanged,
      stats?.linesAdded,
      stats?.linesRemoved,
    );
    console.debug(`Synced workspace ${workspaceId} to remote`);
  } catch (err) {
    console.error(
      `Failed to sync workspace ${workspaceId} to remote: ${err}`,
    );
  }
}

/**
 * Syncs PR data to the remote server.
 * First checks if the workspace exists on remote, then upserts the PR if it does.
 */
export async function syncPrToRemote(
  client: RemoteClient,
  request: API.UpsertPullRequestRequest,
): Promise<void> {
  // First check if workspace exists on remote
  try {
    const exists = await client.workspaceExists(request.localWorkspaceId);
    if (!exists) {
      console.debug(
        `PR #${request.number} workspace ${request.localWorkspaceId} not found on remote, skipping sync`,
      );
      return;
    }
  } catch (err) {
    if (err instanceof RemoteClientError && err.code === 'auth') {
      console.debug(`PR #${request.number} sync skipped: not authenticated`);
      return;
    }
    console.error(
      `Failed to check workspace ${request.localWorkspaceId} existence on remote: ${err}`,
    );
    return;
  }

  const number = request.number;

  // Workspace exists, proceed with PR upsert
  try {
    await client.upsertPullRequest(request);
    console.debug(`Synced PR #${number} to remote`);
  } catch (err) {
    console.error(`Failed to sync PR #${number} to remote: ${err}`);
  }
}

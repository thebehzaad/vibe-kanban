/**
 * Scratch model
 * Translates: crates/db/src/models/scratch.rs
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseType } from '../connection.js';
import type { ExecutorProfileId } from '@runner/executors';

// --- Types ---

export type ScratchType =
  | 'DRAFT_TASK'
  | 'DRAFT_FOLLOW_UP'
  | 'DRAFT_WORKSPACE'
  | 'PREVIEW_SETTINGS'
  | 'WORKSPACE_NOTES'
  | 'UI_PREFERENCES';

export interface DraftFollowUpData {
  message: string;
  executorProfileId: ExecutorProfileId;
}

export interface PreviewSettingsData {
  url: string;
  screenSize?: string;
  responsiveWidth?: number;
  responsiveHeight?: number;
}

export interface WorkspaceNotesData {
  content: string;
}

export interface WorkspacePanelStateData {
  rightMainPanelMode?: string;
  isLeftMainPanelVisible: boolean;
}

export interface UiPreferencesData {
  repoActions?: Record<string, string>;
  expanded?: Record<string, boolean>;
  contextBarPosition?: string;
  paneSizes?: Record<string, unknown>;
  collapsedPaths?: Record<string, string[]>;
  isLeftSidebarVisible?: boolean;
  isRightSidebarVisible?: boolean;
  isTerminalVisible?: boolean;
  workspacePanelStates?: Record<string, WorkspacePanelStateData>;
}

export interface DraftWorkspaceLinkedIssue {
  issueId: string;
  simpleId: string;
  title: string;
  remoteProjectId: string;
}

export interface DraftWorkspaceRepo {
  repoId: string;
  targetBranch: string;
}

export interface DraftWorkspaceData {
  message: string;
  projectId?: string;
  repos: DraftWorkspaceRepo[];
  selectedProfile?: ExecutorProfileId;
  linkedIssue?: DraftWorkspaceLinkedIssue;
}

/**
 * Tagged payload matching Rust's ScratchPayload enum.
 * Serialized as { type: "DRAFT_TASK", data: "..." } etc.
 */
export type ScratchPayload =
  | { type: 'DRAFT_TASK'; data: string }
  | { type: 'DRAFT_FOLLOW_UP'; data: DraftFollowUpData }
  | { type: 'DRAFT_WORKSPACE'; data: DraftWorkspaceData }
  | { type: 'PREVIEW_SETTINGS'; data: PreviewSettingsData }
  | { type: 'WORKSPACE_NOTES'; data: WorkspaceNotesData }
  | { type: 'UI_PREFERENCES'; data: UiPreferencesData };

export interface Scratch {
  id: string;
  payload: ScratchPayload;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScratch {
  payload: ScratchPayload;
}

export interface UpdateScratch {
  payload: ScratchPayload;
}

// --- Error ---

export class ScratchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScratchError';
  }

  static typeMismatch(expected: string, actual: string): ScratchError {
    return new ScratchError(`Scratch type mismatch: expected '${expected}' but got '${actual}'`);
  }
}

// --- Helpers ---

export function scratchType(scratch: Scratch): ScratchType {
  return scratch.payload.type;
}

// --- Row mapping ---

interface ScratchRow {
  id: string;
  scratch_type: string;
  payload: string;
  created_at: string;
  updated_at: string;
}

function rowToScratch(row: ScratchRow): Scratch | undefined {
  try {
    const payload: ScratchPayload = JSON.parse(row.payload);
    if (payload.type !== row.scratch_type) {
      return undefined;
    }
    return {
      id: row.id,
      payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return undefined;
  }
}

// --- Repository ---

export class ScratchRepository {
  constructor(private db: DatabaseType) {}

  create(id: string, data: CreateScratch): Scratch {
    const scratchTypeStr = data.payload.type;
    const payloadStr = JSON.stringify(data.payload);

    this.db.prepare(`
      INSERT INTO scratch (id, scratch_type, payload)
      VALUES (?, ?, ?)
    `).run(id, scratchTypeStr, payloadStr);

    const row = this.db.prepare(`
      SELECT id, scratch_type, payload, created_at, updated_at
      FROM scratch
      WHERE id = ? AND scratch_type = ?
    `).get(id, scratchTypeStr) as ScratchRow;

    return rowToScratch(row)!;
  }

  findById(id: string, scratchTypeVal: ScratchType): Scratch | undefined {
    const row = this.db.prepare(`
      SELECT id, scratch_type, payload, created_at, updated_at
      FROM scratch
      WHERE id = ? AND scratch_type = ?
    `).get(id, scratchTypeVal) as ScratchRow | undefined;

    return row ? rowToScratch(row) : undefined;
  }

  findAll(): Scratch[] {
    const rows = this.db.prepare(`
      SELECT id, scratch_type, payload, created_at, updated_at
      FROM scratch
      ORDER BY created_at DESC
    `).all() as ScratchRow[];

    return rows
      .map(rowToScratch)
      .filter((s): s is Scratch => s !== undefined);
  }

  /**
   * Upsert a scratch record - creates if not exists, updates if exists.
   */
  update(id: string, scratchTypeVal: ScratchType, data: UpdateScratch): Scratch {
    const payloadStr = JSON.stringify(data.payload);

    this.db.prepare(`
      INSERT INTO scratch (id, scratch_type, payload)
      VALUES (?, ?, ?)
      ON CONFLICT(id, scratch_type) DO UPDATE SET
        payload = excluded.payload,
        updated_at = datetime('now', 'subsec')
    `).run(id, scratchTypeVal, payloadStr);

    const row = this.db.prepare(`
      SELECT id, scratch_type, payload, created_at, updated_at
      FROM scratch
      WHERE id = ? AND scratch_type = ?
    `).get(id, scratchTypeVal) as ScratchRow;

    return rowToScratch(row)!;
  }

  delete(id: string, scratchTypeVal: ScratchType): number {
    const result = this.db.prepare(
      'DELETE FROM scratch WHERE id = ? AND scratch_type = ?',
    ).run(id, scratchTypeVal);
    return result.changes;
  }

  findByRowid(rowid: number): Scratch | undefined {
    const row = this.db.prepare(`
      SELECT id, scratch_type, payload, created_at, updated_at
      FROM scratch
      WHERE rowid = ?
    `).get(rowid) as ScratchRow | undefined;

    return row ? rowToScratch(row) : undefined;
  }
}

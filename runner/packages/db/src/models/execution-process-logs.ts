/**
 * Execution process logs model
 * Translates: crates/db/src/models/execution_process_logs.rs
 */

import type { DatabaseType } from '../connection.js';
import type { LogMsg } from '@runner/utils';

// --- Types ---

export interface ExecutionProcessLogs {
  executionId: string;
  logs: string; // JSONL format
  byteSize: number;
  insertedAt: string;
}

// --- Row mapping ---

function rowToLogs(row: any): ExecutionProcessLogs {
  return {
    executionId: row.execution_id,
    logs: row.logs,
    byteSize: row.byte_size,
    insertedAt: row.inserted_at,
  };
}

// --- Repository ---

export class ExecutionProcessLogsRepository {
  constructor(private db: DatabaseType) {}

  findByExecutionId(executionId: string): ExecutionProcessLogs[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM execution_process_logs WHERE execution_id = ? ORDER BY inserted_at ASC',
      )
      .all(executionId) as any[];
    return rows.map(rowToLogs);
  }

  static parseLogs(records: ExecutionProcessLogs[]): LogMsg[] {
    const messages: LogMsg[] = [];
    for (const record of records) {
      for (const line of record.logs.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          messages.push(JSON.parse(trimmed) as LogMsg);
        }
      }
    }
    return messages;
  }

  appendLogLine(executionId: string, jsonlLine: string): void {
    const byteSize = Buffer.byteLength(jsonlLine, 'utf-8');
    this.db
      .prepare(
        `INSERT INTO execution_process_logs (execution_id, logs, byte_size, inserted_at)
         VALUES (?, ?, ?, datetime('now'))`,
      )
      .run(executionId, jsonlLine, byteSize);
  }
}

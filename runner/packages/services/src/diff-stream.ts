/**
 * Diff stream service
 * Translates: crates/services/src/services/diff_stream.rs
 *
 * Streams git diffs and changes.
 */

export interface DiffChunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  chunks: DiffChunk[];
}

export class DiffStreamService {
  // TODO: Implement diff streaming
  async streamDiff(repoPath: string, fromRef: string, toRef: string): AsyncGenerator<FileDiff> {
    throw new Error('Not implemented');
    // eslint-disable-next-line no-unreachable
    yield {} as FileDiff;
  }

  async getDiff(repoPath: string, fromRef: string, toRef: string): Promise<FileDiff[]> {
    throw new Error('Not implemented');
  }
}

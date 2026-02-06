/**
 * File ranker service
 * Translates: crates/services/src/services/file_ranker.rs
 *
 * Ranks files by relevance for search and AI context.
 */

export interface FileRankingCriteria {
  query?: string;
  recentlyModified?: boolean;
  fileSize?: boolean;
  importance?: boolean;
}

export interface RankedFile {
  path: string;
  score: number;
  reasons: string[];
}

export class FileRankerService {
  // TODO: Implement file ranking
  async rankFiles(files: string[], criteria: FileRankingCriteria): Promise<RankedFile[]> {
    throw new Error('Not implemented');
  }
}

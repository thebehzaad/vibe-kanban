/**
 * Diff utilities
 * Translates: crates/utils/src/diff.rs
 */

export type DiffChangeKind =
  | 'Added'
  | 'Deleted'
  | 'Modified'
  | 'Renamed'
  | 'Copied'
  | 'PermissionChange';

export interface FileDiffDetails {
  fileName?: string;
  content?: string;
}

export interface Diff {
  change: DiffChangeKind;
  oldPath?: string;
  newPath?: string;
  oldContent?: string;
  newContent?: string;
  contentOmitted: boolean;
  additions?: number;
  deletions?: number;
  repoId?: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

/**
 * Ensure a string ends with a newline
 */
function ensureNewline(str: string): string {
  return str.endsWith('\n') ? str : str + '\n';
}

/**
 * Create a unified diff between two texts
 */
export function createUnifiedDiff(filePath: string, oldText: string, newText: string): string {
  const hunks = createUnifiedDiffHunks(oldText, newText);
  return concatenateDiffHunks(filePath, hunks);
}

/**
 * Create unified diff hunks from two texts
 */
export function createUnifiedDiffHunks(oldText: string, newText: string): string[] {
  const oldLines = ensureNewline(oldText).split('\n');
  const newLines = ensureNewline(newText).split('\n');

  // Simple diff algorithm - compute changes
  const hunks: string[] = [];
  let hunkContent = '';
  let oldStart = 1;
  let newStart = 1;
  let oldCount = 0;
  let newCount = 0;
  let inHunk = false;

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      // Context line
      if (inHunk) {
        hunkContent += ` ${oldLine ?? ''}\n`;
        oldCount++;
        newCount++;
      }
    } else {
      // Start a new hunk if not in one
      if (!inHunk) {
        inHunk = true;
        oldStart = Math.max(1, i - 2);
        newStart = Math.max(1, i - 2);
        oldCount = 0;
        newCount = 0;
        // Add context lines before change
        for (let j = oldStart - 1; j < i && j < oldLines.length; j++) {
          if (oldLines[j] !== undefined) {
            hunkContent += ` ${oldLines[j]}\n`;
            oldCount++;
            newCount++;
          }
        }
      }

      if (oldLine !== undefined && newLine === undefined) {
        // Deletion
        hunkContent += `-${oldLine}\n`;
        oldCount++;
      } else if (oldLine === undefined && newLine !== undefined) {
        // Addition
        hunkContent += `+${newLine}\n`;
        newCount++;
      } else {
        // Modification
        if (oldLine !== undefined) {
          hunkContent += `-${oldLine}\n`;
          oldCount++;
        }
        if (newLine !== undefined) {
          hunkContent += `+${newLine}\n`;
          newCount++;
        }
      }
    }
  }

  // Flush remaining hunk
  if (inHunk && hunkContent) {
    const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
    hunks.push(header + hunkContent);
  }

  return hunks;
}

/**
 * Extract unified diff hunks from a full unified diff string
 */
export function extractUnifiedDiffHunks(unifiedDiff: string): string[] {
  const lines = unifiedDiff.split('\n');

  if (!lines.some(l => l.startsWith('@@'))) {
    // No @@ headers - treat as single hunk
    const hunkLines = lines.filter(l => l.startsWith(' ') || l.startsWith('+') || l.startsWith('-'));
    if (hunkLines.length === 0) return [];

    const oldCount = hunkLines.filter(l => l.startsWith('-') || l.startsWith(' ')).length;
    const newCount = hunkLines.filter(l => l.startsWith('+') || l.startsWith(' ')).length;

    return [`@@ -1,${oldCount} +1,${newCount} @@\n${hunkLines.join('\n')}\n`];
  }

  const hunks: string[] = [];
  let currentHunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // New hunk starts
      if (currentHunk.length > 0) {
        hunks.push(currentHunk.join('\n') + '\n');
      }
      currentHunk = [line];
    } else if (currentHunk.length > 0) {
      if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-')) {
        currentHunk.push(line);
      }
    }
  }

  // Flush last hunk
  if (currentHunk.length > 0) {
    hunks.push(currentHunk.join('\n') + '\n');
  }

  return hunks;
}

/**
 * Concatenate diff hunks into a full unified diff
 */
export function concatenateDiffHunks(filePath: string, hunks: string[]): string {
  let unifiedDiff = `--- a/${filePath}\n+++ b/${filePath}\n`;

  if (hunks.length > 0) {
    const lines = hunks
      .flatMap(hunk => hunk.split('\n'))
      .filter(line => line.startsWith('@@ ') || line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'));

    unifiedDiff += lines.join('\n');
    if (!unifiedDiff.endsWith('\n')) {
      unifiedDiff += '\n';
    }
  }

  return unifiedDiff;
}

/**
 * Normalize a unified diff to the standard format
 */
export function normalizeUnifiedDiff(filePath: string, unifiedDiff: string): string {
  const hunks = extractUnifiedDiffHunks(unifiedDiff);
  return concatenateDiffHunks(filePath, hunks);
}

/**
 * Compute line change counts between two texts
 */
export function computeLineChangeCounts(oldText: string, newText: string): { additions: number; deletions: number } {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple diff counting
  let additions = 0;
  let deletions = 0;

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  for (const line of oldLines) {
    if (!newSet.has(line)) deletions++;
  }

  for (const line of newLines) {
    if (!oldSet.has(line)) additions++;
  }

  return { additions, deletions };
}

/**
 * Parse a unified diff string into structured FileDiff objects
 */
export function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.split('\n');

  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // File header
    if (line.startsWith('--- ')) {
      if (currentFile) {
        if (currentHunk) currentFile.hunks.push(currentHunk);
        files.push(currentFile);
      }
      currentFile = {
        oldPath: line.slice(4).replace(/^a\//, ''),
        newPath: '',
        hunks: []
      };
      currentHunk = null;
    } else if (line.startsWith('+++ ') && currentFile) {
      currentFile.newPath = line.slice(4).replace(/^b\//, '');
    } else if (line.startsWith('@@') && currentFile) {
      // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      if (currentHunk) currentFile.hunks.push(currentHunk);

      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldLines: parseInt(match[2] || '1', 10),
          newStart: parseInt(match[3], 10),
          newLines: parseInt(match[4] || '1', 10),
          content: ''
        };
      }
    } else if (currentHunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) {
      currentHunk.content += line + '\n';
    }
  }

  // Flush remaining
  if (currentFile) {
    if (currentHunk) currentFile.hunks.push(currentHunk);
    files.push(currentFile);
  }

  return files;
}

/**
 * Apply a diff to original content
 */
export function applyDiff(original: string, diff: FileDiff): string {
  const lines = original.split('\n');
  const result: string[] = [];

  let lineIndex = 0;

  for (const hunk of diff.hunks) {
    // Copy unchanged lines before this hunk
    while (lineIndex < hunk.oldStart - 1) {
      result.push(lines[lineIndex]);
      lineIndex++;
    }

    // Apply hunk changes
    const hunkLines = hunk.content.split('\n');
    for (const hunkLine of hunkLines) {
      if (hunkLine.startsWith(' ')) {
        // Context line
        result.push(hunkLine.slice(1));
        lineIndex++;
      } else if (hunkLine.startsWith('+')) {
        // Addition
        result.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith('-')) {
        // Deletion - skip original line
        lineIndex++;
      }
    }
  }

  // Copy remaining lines
  while (lineIndex < lines.length) {
    result.push(lines[lineIndex]);
    lineIndex++;
  }

  return result.join('\n');
}

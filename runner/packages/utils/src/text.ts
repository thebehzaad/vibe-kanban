/**
 * Text processing utilities
 * Translates: crates/utils/src/text.rs
 */

/**
 * Generate a git branch-friendly ID from text.
 * Matches Rust: git_branch_id()
 */
export function gitBranchId(input: string): string {
  const lower = input.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, '-');
  const trimmed = slug.replace(/^-+|-+$/g, '');
  const cut = trimmed.slice(0, 16);
  return cut.replace(/-+$/, '');
}

/**
 * Get first 4 characters of UUID (without dashes).
 * Matches Rust: short_uuid()
 */
export function shortUuid(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 4);
}

/**
 * Truncate text to a character boundary (safe for multi-byte characters).
 * Matches Rust: truncate_to_char_boundary()
 */
export function truncateToCharBoundary(content: string, maxLen: number): string {
  if (content.length <= maxLen) {
    return content;
  }
  const chars = [...content];
  if (chars.length <= maxLen) {
    return content;
  }
  return chars.slice(0, maxLen).join('');
}

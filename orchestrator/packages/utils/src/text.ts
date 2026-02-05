/**
 * Text processing utilities
 * Translates: crates/utils/src/text.rs
 */

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Truncate text to a character boundary (safe for multi-byte characters)
 */
export function truncateToCharBoundary(content: string, maxLen: number): string {
  if (content.length <= maxLen) {
    return content;
  }
  // In JavaScript, string indexing handles multi-byte chars properly
  // but we still need to be careful with grapheme clusters
  const chars = [...content];
  if (chars.length <= maxLen) {
    return content;
  }
  return chars.slice(0, maxLen).join('');
}

/**
 * Convert text to URL-friendly slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate a git branch-friendly ID from text
 * - Lowercase
 * - Replace non-alphanumerics with hyphens
 * - Trim hyphens
 * - Take up to 16 chars
 */
export function gitBranchId(input: string): string {
  const lower = input.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, '-');
  const trimmed = slug.replace(/^-+|-+$/g, '');
  const cut = trimmed.slice(0, 16);
  return cut.replace(/-+$/, '');
}

/**
 * Get short UUID (first 4 characters)
 */
export function shortUuid(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 4);
}

/**
 * Escape special characters for shell commands
 */
export function escapeShellArg(arg: string): string {
  if (process.platform === 'win32') {
    // Windows: wrap in double quotes and escape internal quotes
    return `"${arg.replace(/"/g, '""')}"`;
  }
  // Unix: wrap in single quotes and escape internal single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Check if a string is a valid UUID
 */
export function isValidUuid(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Convert camelCase to snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Convert snake_case to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Capitalize first letter
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Word wrap text to specified width
 */
export function wordWrap(text: string, width: number): string {
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.join('\n');
}

/**
 * Indent each line of text
 */
export function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(line => prefix + line)
    .join('\n');
}

/**
 * Remove common leading whitespace from all lines
 */
export function dedent(text: string): string {
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter(line => line.trim().length > 0);

  if (nonEmptyLines.length === 0) return text;

  const minIndent = Math.min(
    ...nonEmptyLines.map(line => {
      const match = line.match(/^(\s*)/);
      return match ? match[1].length : 0;
    })
  );

  return lines
    .map(line => line.slice(minIndent))
    .join('\n');
}

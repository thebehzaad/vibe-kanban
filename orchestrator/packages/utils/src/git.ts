/**
 * Git utilities
 * Translates: crates/utils/src/git.rs
 */

export function isValidBranchName(name: string): boolean {
  // Git branch name validation
  const invalidPatterns = [
    /^\./, // starts with .
    /\.\.$/, // ends with ..
    /[\x00-\x1f\x7f~^:?*\[\\]/, // invalid characters
    /@\{/, // @{ sequence
    /\/\// // double slash
  ];

  return !invalidPatterns.some((pattern) => pattern.test(name));
}

export function sanitizeBranchName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_/]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

// TODO: Implement additional git utilities
